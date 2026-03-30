import { SpeechClient } from "@google-cloud/speech";
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";

// Google Cloud Speech-to-Text 클라이언트 초기화
const require = createRequire(import.meta.url);
const serviceAccount = require("../serviceAccountKey.json");

const speechClient = new SpeechClient({
  credentials: serviceAccount,
});

/**
 * 오디오 파일을 텍스트로 변환
 * @param audioFilePath 오디오 파일 경로
 * @param languageCode 언어 코드 (예: 'ko-KR', 'en-US')
 * @param encoding 오디오 인코딩 형식 (예: 'MP3', 'LINEAR16', 'FLAC')
 * @param sampleRateHertz 샘플 레이트 (예: 44100, 16000)
 */
export async function transcribeAudio(
  audioFilePath: string,
  options?: {
    languageCode?: string;
    encoding?: string;
    sampleRateHertz?: number;
  }
): Promise<string> {
  try {
    // 오디오 파일 읽기
    const audioBytes = fs.readFileSync(audioFilePath).toString("base64");

    // 인코딩 형식 자동 감지
    const fileExtension = path.extname(audioFilePath).toLowerCase();
    let encoding: string = options?.encoding || "MP3";
    let sampleRateHertz: number = options?.sampleRateHertz || 44100;

    if (fileExtension === ".wav") {
      encoding = "LINEAR16";
      sampleRateHertz = 44100;
    } else if (fileExtension === ".flac") {
      encoding = "FLAC";
      sampleRateHertz = 44100;
    } else if (fileExtension === ".mp3") {
      encoding = "MP3";
      sampleRateHertz = 44100;
    }

    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding as any,
        sampleRateHertz: sampleRateHertz,
        languageCode: options?.languageCode || "ko-KR",
        enableAutomaticPunctuation: true,
        model: "latest_long", // 최신 장문 모델 사용
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      ?.map((result) => result.alternatives?.[0]?.transcript)
      .join(" ");

    if (!transcription) {
      throw new Error("음성을 인식할 수 없습니다.");
    }

    return transcription;
  } catch (error) {
    console.error("STT 변환 중 오류:", error);
    throw error;
  }
}

/**
 * 오디오 스트림을 텍스트로 변환 (스트리밍)
 * @param audioStream 오디오 스트림
 * @param languageCode 언어 코드
 */
export async function transcribeStream(
  audioStream: NodeJS.ReadableStream,
  options?: {
    languageCode?: string;
    encoding?: string;
    sampleRateHertz?: number;
  }
): Promise<string> {
  try {
    const recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: (options?.encoding || "LINEAR16") as any,
          sampleRateHertz: options?.sampleRateHertz || 44100,
          languageCode: options?.languageCode || "ko-KR",
          enableAutomaticPunctuation: true,
          model: "latest_long",
        },
        interimResults: false,
      })
      .on("error", (error) => {
        console.error("스트리밍 인식 오류:", error);
        throw error;
      })
      .on("data", (data) => {
        if (data.results?.[0]?.alternatives?.[0]) {
          return data.results[0].alternatives[0].transcript;
        }
      });

    audioStream.pipe(recognizeStream);

    return new Promise((resolve, reject) => {
      let transcription = "";
      recognizeStream.on("data", (data) => {
        if (data.results?.[0]?.alternatives?.[0]) {
          transcription += data.results[0].alternatives[0].transcript;
        }
      });
      recognizeStream.on("end", () => {
        resolve(transcription);
      });
      recognizeStream.on("error", reject);
    });
  } catch (error) {
    console.error("스트리밍 STT 변환 중 오류:", error);
    throw error;
  }
}

/**
 * 오디오 Buffer를 텍스트로 변환
 * @param audioBuffer 오디오 Buffer
 * @param options 옵션
 */
export async function transcribeBuffer(
  audioBuffer: Buffer,
  options?: {
    languageCode?: string;
    encoding?: string;
    sampleRateHertz?: number;
  }
): Promise<string> {
  try {
    const audioBytes = audioBuffer.toString("base64");

    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: (options?.encoding || "MP3") as any,
        sampleRateHertz: options?.sampleRateHertz || 44100,
        languageCode: options?.languageCode || "ko-KR",
        enableAutomaticPunctuation: true,
        model: "latest_long",
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      ?.map((result) => result.alternatives?.[0]?.transcript)
      .join(" ");

    if (!transcription) {
      throw new Error("음성을 인식할 수 없습니다.");
    }

    return transcription;
  } catch (error) {
    console.error("Buffer STT 변환 중 오류:", error);
    throw error;
  }
}

