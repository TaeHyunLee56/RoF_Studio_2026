# ElevenLabs TTS 프로젝트

## 설치 방법

레포지토리를 클론한 후 다음 단계를 따라주세요.

### 1. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 API 키를 입력하세요:

```env
ELEVENLABS_API_KEY=<your_api_key_here>
```

### 2. ffmpeg 설치 확인

```powershell
choco install ffmpeg -y
```

### 3. 의존성 패키지 설치

프로젝트 의존성을 설치합니다:

```bash
npm install
```

또는 개별 패키지 설치:

```bash
npm install @elevenlabs/elevenlabs-js dotenv
```

## 실행 방법

다음 명령어로 코드를 실행합니다:

```bash
npx tsx example.mts
```

실행 시 ElevenLabs API를 통해 텍스트가 음성으로 변환되어 재생됩니다.

## 고려사항

eleven_multilingual_v2 모델이 가장 안정적이고 반응 속도가 빠름.
단, LLM 프롬프팅 시 생성된 영문 표현을 다시 한글 표기로 변환하는 별도의 로직이 필요할 듯함.

**외래어, 로마자 용례 오픈 API**
https://korean.go.kr/kornorms/main/openAPI.do
request: searchCondition
response: korean_mark