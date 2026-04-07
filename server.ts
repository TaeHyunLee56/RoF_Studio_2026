import express, { Request, Response } from "express";
import http from "http";
import { Readable } from "stream";
import { Server } from "socket.io";
import session from "express-session";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import "dotenv/config";
import bcrypt from "bcrypt";
import { loadServiceAccount } from "./serviceAccountLoader.js";
import { findVoiceByUserId, createVoiceFromAudio, generateSpeech } from "./modules/TTS.js";
import { getResponse, getInitiation, getEnding, clearHistory, getHistory } from "./modules/LLM/LLM.js";
import { PromptHandler } from "./modules/LLM/promptHandler.ts";

// Express session 타입 확장
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

// Firebase Admin 초기화
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// HTTP 미디어 서버 (Mixed Content 방지: 브라우저는 HTTPS 앱 → /media-proxy → 이 원본으로만 요청)
const MEDIA_ORIGIN_URL = (
  process.env.MEDIA_ORIGIN_URL || "http://143.248.107.38:8186"
).replace(/\/$/, "");

/** Firestore 등에 저장된 절대 URL을 같은 출처 프록시 경로로 바꿈 */
function rewriteMediaUrlForClient(
  url: string | null | undefined
): string | null {
  if (url == null || String(url).trim() === "") return null;
  const u = String(url).trim();
  if (u.startsWith("/media-proxy")) return u;
  try {
    const parsed = new URL(u);
    const base = new URL(`${MEDIA_ORIGIN_URL}/`);
    if (parsed.origin === base.origin) {
      return `/media-proxy${parsed.pathname}${parsed.search}`;
    }
  } catch {
    const prefix = MEDIA_ORIGIN_URL;
    if (u.startsWith(prefix)) {
      const rest = u.slice(prefix.length);
      return `/media-proxy${rest.startsWith("/") ? rest : `/${rest}`}`;
    }
  }
  return u;
}

app.use("/media-proxy", async (req, res) => {
  let suffix = req.originalUrl.replace(/^\/media-proxy/, "") || "/";
  if (!suffix.startsWith("/")) suffix = `/${suffix}`;
  const targetUrl = `${MEDIA_ORIGIN_URL}${suffix}`;
  try {
    const headers = new Headers();
    if (req.headers.range) headers.set("Range", String(req.headers.range));
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: "follow",
    });

    const forwardNames = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
    ];
    for (const name of forwardNames) {
      const v = upstream.headers.get(name);
      if (v) res.setHeader(name, v);
    }
    res.status(upstream.status);

    if (upstream.status === 204 || upstream.body == null) {
      res.end();
      return;
    }

    const body = upstream.body as import("stream/web").ReadableStream<Uint8Array>;
    Readable.fromWeb(body).pipe(res);
  } catch (err) {
    console.error("[media-proxy]", targetUrl, err);
    if (!res.headersSent) {
      res.status(502).type("text/plain").send("미디어 프록시 오류");
    }
  }
});

// ─── 미들웨어 ───
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public", { index: false }));
app.use(
  session({
    secret: "futureme-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// ─── 인증 라우터 ───
app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "login.html"));
});

app.get("/interaction", (req, res) => {
  // Allow access to interaction page without authentication
  res.sendFile(path.join(process.cwd(), "public", "interaction.html"));
});

app.post("/login", async (req, res) => {
  const { userId, password } = req.body;
  // userId = 이름, password = 생년월일 6자리
  const internalId = `${userId}_${password}`;

  try {
    const doc = await firestore.collection("users").doc(internalId).get();
    if (!doc.exists) {
      return res.send(
        `<script>alert("❌ 유저 없음"); window.location.href = "/login";</script>`
      );
    }

    // 세션에 내부 ID 저장
    req.session.userId = internalId;
    console.log(`[Login] Logged in: ${internalId}`);

    // 백그라운드에서 voice 준비 (비동기로 실행, 응답은 기다리지 않음)
    prepareUserVoice(internalId).catch((error) => {
      console.error(`Voice 준비 중 오류 (userId: ${internalId}):`, error);
    });

    // Redirect to futureinteraction.html after successful login
    return res.redirect("/futureinteraction.html");
  } catch (err: any) {
    console.error("[LOGIN ERROR]", err);
    res.send(
      `<script>alert("⚠️ 서버 오류"); window.location.href = "/login";</script>`
    );
  }
});

app.post("/logout", (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error("[LOGOUT ERROR]", err);
        return res
          .status(500)
          .json({ success: false, message: "Logout failed" });
      }
      console.log("[Logout] Logged out successfully");
      res.redirect("/login.html");
    });
  } else {
    res.redirect("/login.html");
  }
});

app.get("/api/current-user", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }
  res.json({ success: true, userId: req.session.userId });
});

// ─── 페르소나 데이터 API ───
app.get("/api/prompt-data", async (req, res) => {
  const userId = req.session?.userId;
  const selectedPersona = req.query.persona as string;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }

  if (!selectedPersona) {
    return res
      .status(400)
      .json({ success: false, message: "No persona selected" });
  }

  try {
    // 사용자 프로필 데이터 가져오기
    const userProfileDoc = await firestore
      .collection("responses")
      .doc(userId)
      .collection("default")
      .doc("data")
      .get();

    // 선택된 페르소나 데이터 가져오기
    const personaDoc = await firestore
      .collection("responses")
      .doc(userId)
      .collection(selectedPersona)
      .doc("data")
      .get();

    // 페르소나 템플릿 변수 가져오기 (vars 문서)
    const varsDoc = await firestore
      .collection("responses")
      .doc(userId)
      .collection(selectedPersona)
      .doc("vars")
      .get();

    const personaCardDoc = await firestore
      .collection("responses")
      .doc(userId)
      .collection(selectedPersona)
      .doc("card")
      .get();

    const cardData = {
      text: personaCardDoc.exists ? personaCardDoc.data()?.text : null,
    };

    // 대화 기록 불러오기 (summary)
    const chatHistoryDoc = await firestore
      .collection("chatHistory")
      .doc(userId)
      .collection(selectedPersona)
      .doc("summary")
      .get();

    let chatHistorySummary: any[] = [];
    if (chatHistoryDoc.exists) {
      const summaryData = chatHistoryDoc.data();
      if (summaryData) {
        // 가장 최근 3개의 기록만 가져오기
        const summaryKeys = Object.keys(summaryData).sort().reverse();
        const lastNSummaries = summaryKeys.slice(0, 3);

        chatHistorySummary = lastNSummaries.map((key, index) => {
          const historyNumber = lastNSummaries.length - index;
          return {
            [`${historyNumber}번째 방문`]: summaryData[key],
          };
        });
      }
    }

    // 사용자 이름 추출
    const getUserName = (): string => {
      if (!userProfileDoc.exists) return "사용자";
      const data = userProfileDoc.data();
      return data?.["사용자 기본 프로필"]?.["이름"] || "사용자";
    };

    const userName = getUserName();

    // vars 문서에서 persona/voice 맵 추출
    const varsData = varsDoc.exists ? varsDoc.data() : {} as any;
    const persona = varsData?.persona ?? {};
    const voice = varsData?.voice ?? {};

    // promptData 생성 — system.json의 {{변수}}와 1:1 매핑
    const promptData = {
      user_name:          persona.user_name ?? userName,
      age:                persona.age ?? "",
      future_job:         persona.future_job ?? "",
      city:               persona.city ?? "",
      life_detail:        persona.life_detail ?? "",
      key_memories:       persona.key_memories ?? "",
      personality_traits: persona.personality_traits ?? "",
      speech_habits:      persona.speech_habits ?? "",
      example_activity:   voice.example_activity ?? "",
      empathy_example:    voice.empathy_example ?? "",
      reflection:         voice.reflection ?? "",
    };

    res.json({
      success: true,
      userProfile: userProfileDoc.exists ? userProfileDoc.data() : null,
      personaData: personaDoc.exists ? personaDoc.data() : null,
      cardData: cardData,
      chatHistory: chatHistorySummary,
      promptData: promptData,
    });
  } catch (error: any) {
    console.error("Error fetching prompt data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching prompt data: " + error.message,
    });
  }
});

// ─── 사용자 페르소나 목록 API ───
app.get("/api/user-personas", async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }

  try {
    // Get user's name from default collection
    const userProfileDoc = await firestore
      .collection("responses")
      .doc(userId)
      .collection("default")
      .doc("data")
      .get();

    const userName = userProfileDoc.exists
      ? (() => {
          const data = userProfileDoc.data();
          return data?.["사용자 기본 프로필"]?.["이름"] || "사용자";
        })()
      : "사용자";

    // Get all collections under the user's responses document
    const userResponsesRef = firestore.collection("responses").doc(userId);
    const collections = await userResponsesRef.listCollections();

    // Filter out 'default' collection and get persona data
    const personas: Array<{
      id: string;
      cardData: any;
      hasData: boolean;
    }> = [];

    for (const collection of collections) {
      if (collection.id !== "default") {
        // Get the card data for this persona
        const cardDoc = await collection.doc("card").get();
        const dataDoc = await collection.doc("data").get();

        personas.push({
          id: collection.id,
          cardData: cardDoc.exists ? cardDoc.data() : null,
          hasData: dataDoc.exists,
        });
      }
    }

    res.json({
      success: true,
      personas,
      userName,
    });
  } catch (error: any) {
    console.error("Error fetching user personas:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user personas",
    });
  }
});

// ─── 비디오 데이터 API ───
app.get("/api/video-data", async (req, res) => {
  const userId = req.session?.userId;
  const selectedPersona = req.query.persona as string;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }

  if (!selectedPersona) {
    return res.status(400).json({ success: false, message: "No persona selected" });
  }

  try {
    // Firestore에서 generatedVideos/{userId} 문서 조회
    const videoDoc = await firestore
      .collection("generatedVideos")
      .doc(userId)
      .get();

    if (!videoDoc.exists) {
      console.log(`[Video API] No video document found for userId: ${userId}`);
      return res.json({
        success: true,
        videoData: { listeningUrl: null, speakingUrl: null },
      });
    }

    const data = videoDoc.data()!;
    const listeningUrl = data.listeningUrl || null;
    const speakingUrl = data.speakingUrl || null;

    console.log(`[Video API] Found videos for userId: ${userId} - listening: ${!!listeningUrl}, speaking: ${!!speakingUrl}`);

    res.json({
      success: true,
      videoData: {
        listeningUrl: rewriteMediaUrlForClient(listeningUrl),
        speakingUrl: rewriteMediaUrlForClient(speakingUrl),
      },
    });
  } catch (error: any) {
    console.error("Error fetching video data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching video data: " + error.message,
    });
  }
});

// ─── Voice 준비 함수 (백그라운드) ───
async function prepareUserVoice(userId: string): Promise<void> {
  try {
    console.log(`[Voice] Voice 준비 시작: ${userId}`);

    // 1. 음성 검색
    let voiceId = await findVoiceByUserId(userId);

    // 2. 음성이 없으면 Firestore에서 가져와서 생성
    if (!voiceId) {
      console.log(
        `음성을 찾을 수 없습니다. Firestore에서 데이터를 가져옵니다... (userId: ${userId})`
      );

      const voiceData = await getVoiceDataFromFirestore(userId);

      if (!voiceData) {
        console.warn(`Firestore에서 voiceData를 가져올 수 없습니다. (userId: ${userId})`);
        return;
      }

      const audioFilePath = await saveAudioToFile(
        voiceData,
        voiceData.audioType || "audio/mp3",
        userId
      );

      voiceId = await createVoiceFromAudio(userId, audioFilePath);

      fs.unlinkSync(audioFilePath);
      console.log(`[Voice] Voice 준비 완료: ${userId} (voiceId: ${voiceId})`);
    } else {
      console.log(`[Voice] Voice 이미 존재: ${userId} (voiceId: ${voiceId})`);
    }
  } catch (error) {
    console.error(`Voice 준비 중 오류 (userId: ${userId}):`, error);
    // 에러가 발생해도 로그인은 계속 진행되도록 함
  }
}

// ─── Firestore에서 voiceData 가져오기 ───
async function getVoiceDataFromFirestore(userId: string) {
  try {
    const voiceDoc = await firestore.collection("voice").doc(userId).get();

    if (!voiceDoc.exists) {
      throw new Error(
        `Firestore에서 userId ${userId}에 대한 데이터를 찾을 수 없습니다.`
      );
    }

    const voiceData = voiceDoc.data();
    console.log("Firestore에서 voiceData를 가져왔습니다.");
    return voiceData;
  } catch (error) {
    console.error("Firestore 데이터 가져오기 오류:", error);
    throw error;
  }
}

// ─── 오디오 데이터를 파일로 저장 ───
async function saveAudioToFile(
  audioData: any,
  audioType: string,
  userId: string
): Promise<string> {
  const tempDir = path.join(process.cwd(), "temp_audio");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const fileExtension = audioType.includes("mp3")
    ? "mp3"
    : audioType.includes("wav")
    ? "wav"
    : audioType.includes("m4a")
    ? "m4a"
    : "mp3";

  const filePath = path.join(
    tempDir,
    `${userId}_${Date.now()}.${fileExtension}`
  );

  let buffer: Buffer;

  if (typeof audioData === "string") {
    buffer = Buffer.from(audioData, "base64");
  } else if (Buffer.isBuffer(audioData)) {
    buffer = audioData;
  } else if (audioData && typeof audioData === "object") {
    if (audioData.storageUrl && typeof audioData.storageUrl === "string") {
      // Firebase Storage URL에서 파일 다운로드
      console.log(`[saveAudioToFile] storageUrl에서 오디오 다운로드 중: ${audioData.storageUrl.substring(0, 80)}...`);
      const response = await fetch(audioData.storageUrl);
      if (!response.ok) {
        throw new Error(`오디오 파일 다운로드 실패: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (audioData.mp3File && typeof audioData.mp3File === "string") {
      buffer = Buffer.from(audioData.mp3File, "base64");
    } else if (audioData.audioData && typeof audioData.audioData === "string") {
      buffer = Buffer.from(audioData.audioData, "base64");
    } else {
      throw new Error(
        "audioData에서 오디오 파일을 찾을 수 없습니다. storageUrl, mp3File 또는 audioData 필드를 확인하세요."
      );
    }
  } else {
    throw new Error(
      `지원하지 않는 audioData 형식입니다. 타입: ${typeof audioData}`
    );
  }

  fs.writeFileSync(filePath, buffer);
  console.log(`오디오 파일이 저장되었습니다: ${filePath}`);
  return filePath;
}

// ─── 텍스트를 문장 단위로 분할 ───
function splitIntoSentences(text: string): string[] {
  // 한국어 문장 구분자: 마침표, 느낌표, 물음표
  // 정규식으로 문장 끝을 찾되, 구분자도 포함
  const sentenceEndings = /([.!?。！？]\s*)/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = sentenceEndings.exec(text)) !== null) {
    const sentence = text.substring(lastIndex, match.index + match[0].length).trim();
    if (sentence.length > 0) {
      parts.push(sentence);
    }
    lastIndex = sentenceEndings.lastIndex;
  }

  // 마지막 부분 처리 (구분자가 없는 경우)
  const remaining = text.substring(lastIndex).trim();
  if (remaining.length > 0) {
    parts.push(remaining);
  }

  // 빈 배열이면 원본 텍스트 반환
  if (parts.length === 0) {
    return [text];
  }

  // 8글자 이내의 짧은 문장을 다음 문장과 합치기
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const current = parts[i];
    
    // 현재 문장이 8글자 이내이고 다음 문장이 있으면 합치기
    if (current.length <= 8 && i + 1 < parts.length) {
      // 현재 문장과 다음 문장을 합침
      merged.push(current + " " + parts[i + 1]);
      i++; // 다음 문장은 이미 합쳐졌으므로 건너뛰기
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ─── 큐 기반 TTS 처리 (문장 단위) ───
async function processTTSQueue(
  userId: string,
  sentences: string[],
  socket: any,
  isEnding: boolean = false
): Promise<void> {
  if (sentences.length === 0) return;

  // 첫 번째 문장부터 순차적으로 처리
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const isLast = i === sentences.length - 1;

    try {
      console.log(`[TTS Queue] Processing sentence ${i + 1}/${sentences.length}: ${sentence.substring(0, 30)}...`);
      
      const audioBase64 = await synthesizeSpeechToBase64(userId, sentence);
      
      // 각 문장의 TTS를 개별 이벤트로 전송
      socket.emit("tts-chunk", {
        audio: audioBase64,
        index: i,
        total: sentences.length,
        isLast: isLast,
        isEnding: isEnding && isLast,
      });

      // 마지막 문장이 아니면 다음 문장 처리를 위해 약간의 딜레이 (선택적)
      // 실제로는 클라이언트에서 재생 완료를 기다리므로 딜레이는 필요 없을 수 있음
    } catch (error: any) {
      console.error(`[TTS Queue] Error processing sentence ${i + 1}:`, error);
      socket.emit("tts-error", {
        error: error.message,
        index: i,
      });
      // 오류가 발생해도 다음 문장 계속 처리
    }
  }
}

// ─── TTS 음성 생성 (Base64 반환) ───
async function synthesizeSpeechToBase64(
  userId: string,
  text: string
): Promise<string> {
  try {
    console.log(`[TTS] 음성 생성 시작 - userId: ${userId}`);
    
    // 1. 음성 검색
    let voiceId = await findVoiceByUserId(userId);
    console.log(`[TTS] ElevenLabs 음성 검색 결과 - voiceId: ${voiceId || '없음'}`);

    // 2. 음성이 없으면 Firestore에서 가져와서 생성
    if (!voiceId) {
      console.log(
        `[TTS] 음성을 찾을 수 없습니다. Firestore에서 데이터를 가져옵니다... (userId: ${userId})`
      );

      try {
        const voiceData = await getVoiceDataFromFirestore(userId);

        if (!voiceData) {
          throw new Error("Firestore에서 voiceData를 가져올 수 없습니다.");
        }

        console.log(`[TTS] Firestore에서 voiceData 가져옴 - 필드 확인:`, Object.keys(voiceData));

        const audioFilePath = await saveAudioToFile(
          voiceData,
          voiceData.audioType || "audio/mp3",
          userId
        );

        console.log(`[TTS] 오디오 파일 저장 완료: ${audioFilePath}`);
        voiceId = await createVoiceFromAudio(userId, audioFilePath);
        console.log(`[TTS] IVC 음성 생성 완료 - voiceId: ${voiceId}`);

        fs.unlinkSync(audioFilePath);
        console.log("[TTS] 임시 오디오 파일이 삭제되었습니다.");
      } catch (firestoreError: any) {
        console.error(`[TTS] Firestore에서 음성 데이터 가져오기 실패:`, firestoreError.message);
        throw new Error(`Firestore에서 음성 데이터를 가져올 수 없습니다: ${firestoreError.message}`);
      }
    }

    // 3. TTS 생성
    console.log(`[TTS] 최종 사용 Voice ID: ${voiceId} (userId: ${userId})`);
    console.log(`[TTS] 생성할 텍스트: ${text.substring(0, 50)}...`);
    const audioStream = await generateSpeech(voiceId, text);

    // 4. 스트림을 Buffer로 변환 후 Base64로 인코딩
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    return audioBuffer.toString("base64");
  } catch (error: any) {
    console.error("TTS 생성 오류:", error);
    throw error;
  }
}

// ─── Socket.IO 이벤트 핸들러 ───
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Store user ID for this socket
  let userId: string | null = null;

  // Handle persona selected event
  socket.on("persona-selected", (data: any) => {
    console.log("Conversation started, broadcasting to all clients:", data);

    // userId 저장
    if (data.userId) {
      userId = data.userId;
      console.log("Socket user ID set from persona-selected:", userId);
    }

    // Save prompt data to file system
    if (data.promptData) {
      console.log("[persona-selected] promptData 수신:", JSON.stringify(data.promptData, null, 2));
      const promptHandler = new PromptHandler();

      const rawPromptData = data.promptData.promptData || data.promptData;
      console.log("[persona-selected] 저장할 promptData:", JSON.stringify(rawPromptData, null, 2));

      promptHandler.savePromptData(rawPromptData);
      console.log("[persona-selected] prompt.json 저장 완료");
    } else {
      console.warn("[persona-selected] promptData가 없습니다. data:", JSON.stringify(data, null, 2));
    }

    // Broadcast the conversation data to all connected clients (interaction 페이지 포함)
    socket.broadcast.emit("persona-selected", data);
    // 현재 소켓에도 전송 (같은 페이지에서 선택한 경우)
    socket.emit("persona-selected", data);
  });

  // Set user ID for this socket
  socket.on("set-user-id", (id: string) => {
    userId = id;
    console.log("Socket user ID set:", userId);
  });

  // Handle user connection for LLM
  socket.on("user-connect", async (data: any) => {
    try {
      console.log("User connect request:", data);

      if (!data.username || !data.personaId) {
        socket.emit("user-connect-error", {
          message: "Missing username or persona ID",
        });
        return;
      }

      // Clear conversation history for new session
      clearHistory();

      // Get initiation message using LLM
      const initiation = await getInitiation();

      // Initiation을 먼저 전송
      socket.emit("initiation", { initiation });

      // Initiation TTS 자동 재생을 위해 큐 기반 TTS 처리
      if (userId) {
        try {
          const sentences = splitIntoSentences(initiation);
          await processTTSQueue(userId, sentences, socket, false);
        } catch (ttsError: any) {
          console.warn("Initiation TTS 실패:", ttsError.message);
          // TTS 실패해도 계속 진행
        }
      }
    } catch (error: any) {
      console.error("Error in user-connect:", error);
      socket.emit("user-connect-error", { message: error.message });
    }
  });

  // Handle speech input for LLM
  socket.on("speech-input", async (data: any) => {
    try {
      console.log("Speech input received:", data);

      if (!data.transcript || !data.personaId) {
        socket.emit("speech-error", {
          error: "Missing transcript or persona ID",
        });
        return;
      }

      // Check if this is the ending conversation (5회 이상)
      // conversationCount는 0부터 시작하므로 >= 4일 때 5번째 대화
      if (data.conversationCount >= 4) {
        console.log(`[Ending] 5번째 대화 시작 (conversationCount: ${data.conversationCount})`);
        
        const ending = await getEnding(data.transcript);
        console.log(`[Ending] Ending 응답 생성 완료: ${ending.substring(0, 50)}...`);
        
        socket.emit("speech-response", {
          response: ending,
          isEnding: true,
        });

        // Ending TTS 큐 기반 처리
        if (userId) {
          try {
            const sentences = splitIntoSentences(ending);
            await processTTSQueue(userId, sentences, socket, true);
          } catch (ttsError: any) {
            console.warn("Ending TTS 생성 실패:", ttsError.message);
          }
        }

        // 대화 종료 시 chatHistory 저장
        if (userId && data.personaId) {
          console.log(`[ChatHistory] 저장 시작 (userId: ${userId}, personaId: ${data.personaId})`);
          try {
            await saveChatHistory(userId, data.personaId);
            console.log(`[ChatHistory] 저장 완료`);
          } catch (saveError: any) {
            console.error("[ChatHistory] 저장 실패:", saveError);
          }
        } else {
          console.warn(`[ChatHistory] 저장 실패 - userId: ${userId}, personaId: ${data.personaId}`);
        }
        return;
      }

      // Get regular response using LLM
      const response = await getResponse(data.transcript);

      // 응답 전송
      socket.emit("speech-response", {
        response,
        isEnding: false,
      });

      // TTS 큐 기반 처리 (문장 단위)
      if (userId) {
        try {
          const sentences = splitIntoSentences(response);
          await processTTSQueue(userId, sentences, socket, false);
        } catch (ttsError: any) {
          console.warn("TTS 생성 실패:", ttsError.message);
          socket.emit("tts-error", { error: ttsError.message });
        }
      }
    } catch (error: any) {
      console.error("Error in speech-input:", error);
      socket.emit("speech-error", { error: error.message });
    }
  });

  // Handle TTS requests
  socket.on("tts-request", async (data: any) => {
    try {
      console.log("TTS request received:", data);

      if (!data.text || !data.personaId) {
        socket.emit("tts-error", { error: "Missing text or persona ID" });
        return;
      }

      let audioBase64: string;

      // Check if we have a userId for voice cloning
      if (userId) {
        console.log(`[Voice] Using voice cloning for user: ${userId}`);
        try {
          audioBase64 = await synthesizeSpeechToBase64(userId, data.text);
        } catch (voiceError: any) {
          console.warn(
            "[Voice] Voice cloning failed, falling back to default:",
            voiceError.message
          );
          // Fallback to default voice (you can implement this)
          audioBase64 = await synthesizeSpeechToBase64(userId, data.text);
        }
      } else {
        console.log("[Voice] No userId available, using default voice");
        // You might want to use a default voice ID here
        // For now, we'll still try to use userId if available in session
        socket.emit("tts-error", {
          error: "User ID not available for voice cloning",
        });
        return;
      }

      socket.emit("tts-response", { audio: audioBase64 });
    } catch (error: any) {
      console.error("Error in tts-request:", error);
      socket.emit("tts-error", { error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

  // 시리얼/BLE 명령 브로드캐스트 — 한 탭에서 emit하면 모든 탭(연결된 보드)에 전달
  socket.on("serial:command", (cmd: string) => {
    io.emit("serial:command", cmd);
  });
});

// ─── Chat History 저장 함수 ───
async function saveChatHistory(
  userId: string,
  personaId: string
): Promise<void> {
  try {
    console.log(`[saveChatHistory] 시작 - userId: ${userId}, personaId: ${personaId}`);
    const conversationHistory = getHistory();
    console.log(`[saveChatHistory] 대화 기록 길이: ${conversationHistory.length}`);
    
    if (conversationHistory.length === 0) {
      console.log("[saveChatHistory] 저장할 대화 기록이 없습니다.");
      return;
    }

    // 타임스탬프 기반 키 생성
    const conversationKey = new Date().toISOString();
    console.log(`[saveChatHistory] Conversation key: ${conversationKey}`);

    // Firestore에 대화 기록 저장 (media.js 방식: chatHistory/{userId}/{personaId}/data)
    await firestore
      .collection("chatHistory")
      .doc(userId)
      .collection(personaId)
      .doc("data")
      .set(
        {
          [conversationKey]: conversationHistory,
        },
        { merge: true }
      );

    console.log(`[saveChatHistory] Chat history saved for ${userId}/${personaId}`);

    // 요약 생성 및 저장
    try {
      console.log(`[saveChatHistory] 요약 생성 시작`);
      await generateAndSaveSummary(userId, personaId, conversationHistory, conversationKey);
      console.log(`[saveChatHistory] 요약 생성 완료`);
    } catch (summaryError: any) {
      console.warn("[saveChatHistory] Summary 생성 실패:", summaryError.message);
    }
  } catch (error: any) {
    console.error("[saveChatHistory] Chat history 저장 오류:", error);
    throw error;
  }
}

// ─── 요약 생성 및 저장 함수 ───
async function generateAndSaveSummary(
  userId: string,
  personaId: string,
  conversationHistory: Array<{ role: string; content: string }>,
  conversationKey: string
): Promise<void> {
  try {
    const OpenAI = require("openai");
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const conversationText = conversationHistory
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "사용자와 사용자의 10년 뒤 미래 자아 간의 대화를 300자 이내로 요약해줘. 핵심 주제, 감정 표현, 중요한 인사이트를 중심으로 간결하게 정리해줘.",
        },
        {
          role: "user",
          content: `이 대화를 요약해줘:\n\n${conversationText}`,
        },
      ],
    });

    const summary = completion.choices[0].message.content;

    // 요약 저장
    await firestore
      .collection("chatHistory")
      .doc(userId)
      .collection(personaId)
      .doc("summary")
      .set(
        {
          [conversationKey]: summary,
        },
        { merge: true }
      );

    console.log(`[Summary] Summary saved for ${userId}/${personaId}`);
  } catch (error: any) {
    console.error("Summary 생성 오류:", error);
    throw error;
  }
}

// ─── Chat History 저장 API 엔드포인트 ───
app.post("/api/save-conversation", async (req, res) => {
  const userId = req.session?.userId || req.body.userId;
  const { conversationHistory, selectedPersona, conversationKey } = req.body;

  if (!userId) {
    return res.status(401).json({ success: false, message: "No user ID provided" });
  }

  if (!conversationHistory || !selectedPersona || !conversationKey) {
    return res.status(400).json({ success: false, message: "Missing required data" });
  }

  try {
    // Use merge: true to add the new conversation without overwriting existing ones
    await firestore
      .collection("chatHistory")
      .doc(userId)
      .collection(selectedPersona)
      .doc("data")
      .set(
        {
          [conversationKey]: conversationHistory,
        },
        { merge: true }
      );

    res.json({ success: true, message: "Conversation saved successfully" });
  } catch (error: any) {
    console.error("Error saving conversation:", error);
    res.status(500).json({ success: false, message: "Error saving conversation" });
  }
});

// ─── 요약 생성 API 엔드포인트 ───
app.post("/api/generate-summary", async (req, res) => {
  const userId = req.session?.userId || req.body.userId;
  const { conversationHistory, selectedPersona, conversationKey } = req.body;

  if (!userId) {
    return res.status(401).json({ success: false, message: "No user ID provided" });
  }

  if (!conversationHistory || !selectedPersona || !conversationKey) {
    return res.status(400).json({ success: false, message: "Missing required data" });
  }

  try {
    await generateAndSaveSummary(userId, selectedPersona, conversationHistory, conversationKey);
    res.json({ success: true, message: "Summary generated and saved successfully" });
  } catch (error: any) {
    console.error("Error generating summary:", error);
    res.status(500).json({ success: false, message: "Error generating summary" });
  }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST ?? "0.0.0.0";
server.listen(PORT, HOST, () => {
  const local =
    HOST === "0.0.0.0" || HOST === "::"
      ? ` — 브라우저: http://localhost:${PORT}`
      : "";
  console.log(`[Server] bind ${HOST}:${PORT}${local}`);
});
