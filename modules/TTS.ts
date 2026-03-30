import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Readable } from "stream";
import * as fs from "fs";

// ElevenLabs 클라이언트 초기화
const client = new ElevenLabsClient({
  environment: "https://api.elevenlabs.io",
});

/**
 * userId로 음성 검색
 */
export async function findVoiceByUserId(
  userId: string
): Promise<string | null> {
  try {
    console.log(`[findVoiceByUserId] ElevenLabs에서 음성 검색 시작 - userId: ${userId}`);
    const response = await client.voices.search({
      search: userId,
      pageSize: 100,
    });

    const apiResponse = response as any;
    if (apiResponse.ok === false) {
      console.error("[findVoiceByUserId] 음성 검색 실패:", apiResponse.error);
      return null;
    }

    const voices = (apiResponse.body || apiResponse).voices || [];
    console.log(`[findVoiceByUserId] 검색된 음성 개수: ${voices.length}`);
    
    // 디버깅: 모든 음성 이름 출력
    if (voices.length > 0) {
      console.log(`[findVoiceByUserId] 검색된 음성 목록:`, voices.map((v: any) => ({
        name: v.name,
        voiceId: v.voiceId || v.voice_id
      })));
    }

    const voice = voices.find((v: any) => v.name === userId);

    if (voice) {
      const voiceId = voice.voiceId || voice.voice_id;
      console.log(`[findVoiceByUserId] 음성을 찾았습니다! - name: ${voice.name}, voiceId: ${voiceId}`);
      return voiceId;
    }

    console.log(`[findVoiceByUserId] userId "${userId}"와 일치하는 음성을 찾을 수 없습니다.`);
    return null;
  } catch (error) {
    console.error("[findVoiceByUserId] 음성 검색 중 오류:", error);
    return null;
  }
}

/**
 * 오디오 파일로부터 IVC 음성 생성
 */
export async function createVoiceFromAudio(
  userId: string,
  audioFilePath: string
): Promise<string> {
  try {
    const fileStream = fs.createReadStream(audioFilePath);

    console.log("IVC 음성 생성 중...");
    const response = await client.voices.ivc.create({
      name: userId,
      files: [fileStream],
      removeBackgroundNoise: true,
    });

    const responseData = response as any;
    const voiceId = responseData?.voiceId;

    if (!voiceId) {
      throw new Error("IVC 생성 응답에서 voiceId를 찾을 수 없습니다.");
    }

    console.log(`음성이 생성되었습니다. Voice ID: ${voiceId}`);
    return voiceId;
  } catch (error) {
    console.error("IVC 생성 중 오류:", error);
    throw error;
  }
}

/**
 * 텍스트를 음성으로 변환하여 스트림 반환
 */
export async function generateSpeech(
  voiceId: string,
  text: string,
  options?: {
    modelId?: string;
    outputFormat?: string;
  }
): Promise<Readable> {
  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text: text,
      modelId: options?.modelId || "eleven_multilingual_v2",
      outputFormat: (options?.outputFormat || "mp3_44100_128") as any,
    });

    const reader = audio.getReader();
    const stream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(value);
        }
      },
    });

    return stream;
  } catch (error) {
    console.error("TTS 생성 중 오류:", error);
    throw error;
  }
}

/**
 * 텍스트를 음성으로 변환하여 파일로 저장
 */
export async function generateSpeechToFile(
  voiceId: string,
  text: string,
  outputPath: string,
  options?: {
    modelId?: string;
    outputFormat?: "mp3_44100_128" | "mp3_44100_192" | "mp3_44100_256" | "pcm_16000" | "pcm_22050" | "pcm_24000" | "pcm_44100" | "ulaw_8000";
  }
): Promise<string> {
  try {
    const stream = await generateSpeech(voiceId, text, options);
    const writeStream = fs.createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      stream.pipe(writeStream);
      writeStream.on("finish", () => {
        console.log(`음성 파일이 저장되었습니다: ${outputPath}`);
        resolve(outputPath);
      });
      writeStream.on("error", reject);
    });
  } catch (error) {
    console.error("음성 파일 저장 중 오류:", error);
    throw error;
  }
}

