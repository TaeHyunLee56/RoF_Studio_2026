# ESP32 Feather BLE 시리얼 통신 설정 가이드

이 문서는 RoF Studio 앱에서 ESP32 Feather 보드와 Web Bluetooth(BLE) 시리얼 통신을 설정하는 방법을 설명합니다.

## 📋 목차

1. [하드웨어 요구사항](#하드웨어-요구사항)
2. [ESP32 BLE 펌웨어 설정](#esp32-ble-펌웨어-설정)
3. [브라우저 설정](#브라우저-설정)
4. [사용 방법](#사용-방법)
5. [시리얼 명령어](#시리얼-명령어)
6. [문제 해결](#문제-해결)

---

## 🔌 하드웨어 요구사항

- **ESP32 Feather** (또는 Nordic UART Service를 지원하는 BLE 보드)
- **NeoPixel LED 스트립** (200개 LED, 6개 스트립 등)
  - GPIO 핀은 보드에 맞게 설정

---

## 💾 ESP32 BLE 펌웨어 설정

### Nordic UART Service (NUS) 사용

웹 앱은 **Nordic UART Service** UUID를 사용합니다. ESP32 쪽에서 동일한 서비스/캐릭터리스틱을 구현해야 합니다.

- **서비스 UUID**: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **TX (쓰기)**: `6e400002-b5a3-f393-e0a9-e50e24dcca9e` — 앱 → ESP32
- **RX (알림)**: `6e400003-b5a3-f393-e0a9-e50e24dcca9e` — ESP32 → 앱

Arduino/ESP-IDF에서 BLE 시리얼 예제(Nordic UART 또는 BLE UART)를 사용하거나, 위 UUID로 서비스/캐릭터리스틱을 직접 구현하면 됩니다.

### 시리얼 명령 프로토콜

- `i` — 가속 (intro)
- `o` — 감속 (outro)
- `x` — LED 끄기 (off)

---

## 🌐 브라우저 설정

### 지원 브라우저

Web Bluetooth API를 지원하는 브라우저가 필요합니다:

- ✅ **Chrome** (89 이상)
- ✅ **Edge** (89 이상)
- ✅ **Opera** (75 이상)
- ❌ Firefox (현재 미지원)
- ❌ Safari (현재 미지원)

### HTTPS 요구사항

Web Bluetooth API는 보안상 HTTPS 또는 localhost에서만 동작합니다.

**개발 환경:**
- `http://localhost:3000` ✅
- `http://127.0.0.1:3000` ✅

**프로덕션 환경:**
- HTTPS 인증서가 필요합니다.

## 🚀 사용 방법

### 1. 서버 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 또는 프로덕션 서버 실행
npm start
```

### 2. ESP32 연결

1. 브라우저에서 `http://localhost:3000/futureinteraction` 페이지를 엽니다.
2. Q 키를 눌러 시리얼 패널을 연 뒤 **"ESP32 연결"** 버튼을 클릭합니다.
3. 브라우저가 BLE 기기 선택 대화상자를 표시합니다.
4. Nordic UART Service를 광고하는 ESP32 기기를 선택하고 **연결**합니다.
5. 연결 상태가 **"ESP32 연결됨"**으로 바뀌면 준비 완료입니다.

### 3. 대화 시작

1. **"대화하기"** 버튼을 클릭합니다.
2. 자동으로 다음 이벤트가 순차 실행됩니다:
   - **Tunnel 비디오 시작** → ESP32에 `i` (가속) 명령 전송
   - **대화 진행** → LED 효과 유지
   - **Closing 비디오 시작** → ESP32에 `o` (감속) 명령 전송
   - **Closing 비디오 종료** → ESP32에 `x` (LED 끄기) 명령 전송
   - **Blackout 화면** → ESP32에 `x` (LED 끄기) 명령 재전송

### 4. 테스트 (선택사항)

BLE 시리얼만 테스트하려면:
- `http://localhost:3000/serial-test.html` 접속
- "ESP32 연결" 후 개별 명령 테스트 (가속/감속/끄기) 및 로그 확인

---

## 📡 시리얼 명령어

앱에서 ESP32(BLE)로 전송하는 명령어:

| 명령어 | 설명 | 방향 | 전송 시점 | 종료 |
|--------|------|------|-----------|------|
| `i` | 가속 (LED 라인 속도 증가) | ▶ 정방향 | Tunnel 비디오 시작 시 | 11초 후 자동 blackout |
| `o` | 감속 (LED 라인 속도 감소) | ◀ 역방향 | Closing 비디오 시작 시 | 4초 후 자동 blackout |
| `x` | LED 끄기 (모든 LED OFF) | - | Closing 비디오 종료 시 또는 리셋 시 | 즉시 |

### ESP32의 동작 (참고)

#### `i` 명령 (가속 - 정방향)
- **방향**: 정방향 (→) - START_LED(50) → END_LED(199)
- **속도 변화**: 11초 동안 가속
  - 시작: BASE_STEP_DELAY = 0.003초
  - 종료: MIN_STEP_DELAY = 0.0006초
- **자동 종료**: 11초 후 자동으로 blackout + off 모드 전환

#### `o` 명령 (감속 - 역방향)
- **방향**: 역방향 (←) - END_LED(199) → START_LED(50)
- **속도 변화**: 4초 동안 감속
  - 시작: BASE_STEP_DELAY = 0.003초
  - 종료: MAX_STEP_DELAY = 0.05초
- **자동 종료**: 4초 후 자동으로 blackout + off 모드 전환

#### `x` 명령 (LED 끄기)
- **동작**: 즉시 모든 LED 끄기 (blackout)
- **모드**: off 모드로 전환

### 동작 흐름 예시

```
[00:00] 'i' 명령 수신
[00:00] 정방향(→) 가속 시작 (0.003초 → 0.0006초)
[00:11] 자동 blackout + off 모드 전환
        → LED 완전히 꺼짐, 대기 상태

[05:30] 'o' 명령 수신
[05:30] 역방향(←) 감속 시작 (0.003초 → 0.05초)
[05:34] 자동 blackout + off 모드 전환
        → LED 완전히 꺼짐, 대기 상태

[05:37] 'x' 명령 수신
[05:37] 즉시 blackout (이미 off지만 안전장치)
```

---

## 🔧 문제 해결

### 1. "Web Bluetooth API를 지원하지 않는 브라우저입니다"

**해결책:**
- Chrome, Edge, Opera 브라우저를 사용하세요.
- 브라우저를 최신 버전으로 업데이트하세요.

### 2. BLE 기기가 목록에 표시되지 않음

**해결책:**
- ESP32가 전원이 켜져 있고 BLE를 광고 중인지 확인하세요.
- Nordic UART Service를 광고하도록 펌웨어가 설정되어 있는지 확인하세요.
- 다른 기기와 페어링되어 있지 않은지 확인하세요 (필요 시 펌웨어에서 재시작).
- HTTPS 또는 localhost에서 페이지를 열었는지 확인하세요.

### 3. 연결 후 명령이 작동하지 않음

**해결책:**
- ESP32 펌웨어가 NUS UUID로 서비스/캐릭터리스틱을 구현했는지 확인하세요.
- `i`, `o`, `x` 수신 시 LED 제어 로직이 동작하는지 확인하세요.
- ESP32를 재부팅한 뒤 다시 연결해 보세요.

### 4. LED가 점등되지 않음

**해결책:**
- NeoPixel LED 스트립의 전원과 GPIO 연결을 확인하세요.
- ESP32 코드의 LED 개수/핀 설정이 실제 하드웨어와 일치하는지 확인하세요.

### 5. 콘솔 오류 확인

브라우저 개발자 도구(F12)를 열어 콘솔 메시지를 확인하세요:

```javascript
// 성공적인 연결
[SerialController] BLE 연결됨 (Nordic UART Service)
[SerialController] 명령 전송: i
[ESP32] 가속 명령(i) 전송 성공

// 명령별 로그
[SerialController] 명령 전송: o
[ESP32] 감속 명령(o) 전송 성공

[SerialController] 명령 전송: x
[ESP32] LED 끄기 명령(x) 전송 성공

// 실패 시
[SerialController] 연결 실패: ...
[SerialController] 명령 전송 실패: ...
[ESP32] 가속 명령(i) 전송 실패
```

### 6. LED가 자동으로 꺼지지 않음

**증상:** `i` 또는 `o` 명령 후 LED가 계속 켜져 있음

**해결책:**
- ESP32 펌웨어의 가속/감속 완료 후 자동 blackout 로직 확인

---

## 🎨 커스터마이징

### LED 효과 조정

`main.py`에서 다음 변수를 조정할 수 있습니다:

```python
# ===============================
# 기본 설정
# ===============================
NUM_LEDS = 200              # LED 개수
BRIGHTNESS_FACTOR = 0.3     # 밝기 (0.0 ~ 1.0)
BASE_STEP_DELAY = 0.003     # 기본 속도 (초 단위) - 초고속 설정
START_LED = 50              # 시작 LED 인덱스
END_LED = 199               # 종료 LED 인덱스

# 꼬리 효과
LINE_SIZE = 4               # 꼬리 길이
FADE_LEVEL = [255, 100, 20, 5]  # 페이드 레벨 (밝기 단계)

# 라인 생성
SPAWN_GAP = 10              # 라인 생성 간격 (프레임 수)
MAX_LINES = 20              # 최대 동시 라인 수

# GPIO 핀 설정
PINS = [2, 3, 4, 5, 6, 7]  # NeoPixel 스트립 연결 핀

# ===============================
# 시간 연출 (길이 고정)
# ===============================
ACCEL_DURATION = 11.0       # 가속 시간 (초) - 'i' 명령
DECEL_DURATION = 4.0        # 감속 시간 (초) - 'o' 명령

# 속도 범위
MIN_STEP_DELAY = 0.0006     # 최소 딜레이 (최대 속도) - 가속 종료 시
MAX_STEP_DELAY = 0.05       # 최대 딜레이 (최소 속도) - 감속 종료 시
```

### 방향 제어

방향은 명령에 따라 자동으로 설정됩니다:
- **`i` 명령**: `direction = 1` (정방향 →)
- **`o` 명령**: `direction = -1` (역방향 ←)

수동으로 방향을 변경하려면 `main.py`의 명령 처리 부분을 수정하세요.

### 시리얼 명령 추가

새로운 명령을 추가하려면:

1. `modules/SerialController.ts`에 새 메서드 추가:

```typescript
async customCommand(): Promise<boolean> {
  return await this.sendCommand('c'); // 새 명령어
}
```

2. `main.py`에서 명령 처리 추가:

```python
if cmd == 'c':
    # 커스텀 동작
    print("Custom command received")
```

3. `futureinteraction.html`에서 원하는 시점에 호출:

```javascript
await serialController.customCommand();
```

### 방향 제어 커스터마이징

기본적으로 `i`는 정방향, `o`는 역방향입니다. 이를 변경하려면 `main.py`의 명령 처리 부분을 수정하세요:

```python
if cmd == 'i':
    mode = "accelerate"
    direction = 1          # 정방향 (변경 가능)
    mode_start_time = time.ticks_ms()

elif cmd == 'o':
    mode = "decelerate"
    direction = -1         # 역방향 (변경 가능)
    mode_start_time = time.ticks_ms()
```

---

## 📚 참고 자료

- [Web Bluetooth API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [ESP32 BLE 문서](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/bluetooth/index.html)
- [MicroPython 문서](https://docs.micropython.org/)
- [NeoPixel 라이브러리 문서](https://docs.micropython.org/en/latest/esp8266/tutorial/neopixel.html)

---

## 📝 라이센스

이 프로젝트는 [라이센스 정보]에 따라 배포됩니다.

---

## 🤝 기여

버그 리포트나 기능 제안은 이슈 트래커를 통해 제출해주세요.

