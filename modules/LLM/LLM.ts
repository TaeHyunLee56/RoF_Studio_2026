import "dotenv/config";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({ apiKey: key });
}

let conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

/** ---------- 공용 유틸 ---------- */
async function readJSON(filePath: string): Promise<any> {
  const raw = await fsPromises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/** JSON 객체의 모든 문자열 value를 재귀적으로 이어붙여 하나의 문자열로 반환 */
function flattenValues(obj: any, visited = new Set()): string {
  let values: string[] = [];
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    if (typeof obj[key] === "object" && obj[key] !== null) {
      if (visited.has(obj[key])) continue;
      visited.add(obj[key]);
      values.push(flattenValues(obj[key], visited));
    } else {
      values.push(String(obj[key]));
    }
  }
  return values.join(" ");
}

/** system.json 내 {{변수}}를 prompt.json 값으로 치환하여 최종 시스템 프롬프트 생성 */
async function buildSystemInstruction(): Promise<string> {
  const system = await readJSON(path.join(PROMPTS_DIR, "system.json"));
  const vars = await readJSON(path.join(PROMPTS_DIR, "prompt.json"));

  // 고정 변수 (사용자 변경과 무관하게 유지)
  const fixedVars: Record<string, string> = {
    agent_year: "2036",
    agent_month: "4월",
    user_year: "2026",
    user_month: "4월",
  };
  Object.assign(vars, fixedVars);

  // system.json을 문자열로 평탄화
  let instruction = flattenValues(system);

  // {{key}} 패턴을 prompt.json의 값으로 치환
  instruction = instruction.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (vars[key] !== undefined && vars[key] !== null) {
      return String(vars[key]);
    }
    console.warn(`[LLM] 템플릿 변수 미발견: ${match}`);
    return match;
  });

  return instruction;
}


/** ---------- 모델 호출 공통 ---------- */
function truncateHistoryIfNeeded() {
  const messages = conversationHistory.map((m) => ({ ...m }));
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  console.log(`Total estimated tokens: ${estimatedTokens}`);

  if (estimatedTokens > 100000) {
    console.log(
      `⚠️ Total tokens too high (${estimatedTokens}), truncating conversation history`
    );
    const maxHistoryTokens = 15000; // 보수적
    let truncated: typeof conversationHistory = [];
    let historyChars = 0;

    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      const msgChars = msg.content.length;
      if (historyChars + msgChars < maxHistoryTokens * 4) {
        truncated.unshift(msg);
        historyChars += msgChars;
      } else break;
    }
    conversationHistory = truncated;
    console.log(
      `✅ Truncated conversation history to ${conversationHistory.length} messages`
    );
  }
}

/** ---------- 공개 API ---------- */
export async function getResponse(message: string): Promise<string> {
  try {
    const systemInstruction = await buildSystemInstruction();

    conversationHistory.push({ role: "user", content: message });

    truncateHistoryIfNeeded();

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemInstruction },
        ...conversationHistory,
      ],
    });

    let response = completion.choices[0].message.content || "";
    // response = humanize(response);
    // response = sanitizeOutput(response);

    conversationHistory.push({ role: "assistant", content: response });
    return response;
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; code?: string };
    console.error(
      "[getResponse]",
      err?.message ?? String(error),
      err?.status != null ? `status=${err.status}` : "",
      err?.code ?? ""
    );
    return "미안, 지금은 답을 만들기 어려워.";
  }
}

export async function getInitiation(): Promise<string> {
  try {
    const systemInstruction = await buildSystemInstruction();
    
    conversationHistory = []; // 첫 인사 전 기록 초기화

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemInstruction },
        {
          role: "user",
          content: "10년 전 너에게 인사를 건네는 대화를 시작하라. '안녕, 나는 10년 후의 너야'라고 말한 후에 지금 어떻게 살고 있는지 설명하고 질문을 기다려, 어떻게 살고 있는지는 20단어 이내로 설명해",
        },
      ],
    });

    let out = completion.choices[0].message.content || "";
    // out = humanize(out);
    // out = sanitizeOutput(out);
    return out;
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; code?: string };
    console.error(
      "[getInitiation]",
      err?.message ?? String(error),
      err?.status != null ? `status=${err.status}` : "",
      err?.code ?? ""
    );
    return "미안, 지금은 시작 인사를 만들기 어렵네.";
  }
}

export async function getEnding(message: string): Promise<string> {
  try {
    console.log("[getEnding] 시작 - 프롬프트 빌드");
    const systemInstruction = await buildSystemInstruction();
    console.log("[getEnding] System instruction 길이:", systemInstruction.length);

    conversationHistory.push({
      role: "user",
      content: `${message}에 답변한 후 '음... 아쉽게도 오늘 대화는 여기까지야. 잘 지내고 다음에 또 얘기하자'라고 끝인사를 해.`,
    });

    truncateHistoryIfNeeded();

    console.log("[getEnding] OpenAI API 호출 시작");
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemInstruction },
        ...conversationHistory,
      ],
    });

    let out = completion.choices[0].message.content || "";
    console.log("[getEnding] OpenAI 응답 받음:", out.substring(0, 100));
    
    // 작별인사가 포함되었는지 확인하고, 없으면 기본 작별인사 추가
    const farewellKeywords = /(안녕|잘가|다음에|봐|고마워|작별|끝|마무리)/;
    if (!farewellKeywords.test(out)) {
      console.log("[getEnding] 작별인사 키워드 없음 - 기본 작별인사 추가");
      out = `${out} 아쉽게도 오늘 대화는 여기까지야. 잘 지내고 다음에 또 얘기하자.`;
    }

    // Ending 응답도 conversationHistory에 추가
    conversationHistory.push({ role: "assistant", content: out });
    console.log("[getEnding] 완료 - conversationHistory 길이:", conversationHistory.length);

    return out;
  } catch (error) {
    console.error("[getEnding] 오류:", error);
    return "다음에 또 이어서 얘기하자. 잘가!";
  }
}

/**
 * 대화 기록 초기화
 */
export function clearHistory() {
  conversationHistory = [];
}

/**
 * 현재 대화 기록 가져오기
 */
export function getHistory() {
  return [...conversationHistory];
}

