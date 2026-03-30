import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptHandler {
  savePromptData(promptData: any) {
    try {
      const promptsDir = path.join(__dirname, "prompts");
      const promptFile = path.join(promptsDir, "prompt.json");

      if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true });
      }

      fs.writeFileSync(promptFile, JSON.stringify(promptData, null, 2));
      console.log("[promptHandler] Prompt data saved to:", promptFile);
    } catch (error) {
      console.error("[promptHandler] Error saving prompt data:", error);
    }
  }
}

