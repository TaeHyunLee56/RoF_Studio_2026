/**
 * SerialController.js
 * Web Bluetooth API를 통해 ESP32 Feather(BLE)와 시리얼 통신을 관리하는 클래스
 * Nordic UART Service (NUS) 사용 — ESP32 BLE 시리얼 예제와 호환
 *
 * 각 HTML에서 <script src="/js/SerialController.js"></script>로 로드하여 사용
 */

// Nordic UART Service (NUS) UUID — ESP32 BLE 시리얼에서 흔히 사용
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // 쓰기 (앱 → 기기)
const NUS_RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 알림 (기기 → 앱)

class SerialController {
    constructor(logFn) {
        this.device = null;
        this.server = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        this.isConnected = false;
        this.onStatusChange = null;
        this.logFn = logFn || null;

        if (!navigator.bluetooth) {
            console.error('[SerialController] Web Bluetooth API is not supported in this browser.');
        }
    }

    _log(msg, type = 'info') {
        if (this.logFn) this.logFn(msg, type);
        else if (type === 'error') console.error('[SerialController]', msg);
        else console.log('[SerialController]', msg);
    }

    /**
     * BLE 기기 선택 후 Nordic UART Service로 연결
     * @param {number} _baudRate - 호환성용 (BLE에서는 미사용)
     */
    async connect(_baudRate = 115200) {
        try {
            if (!navigator.bluetooth) {
                throw new Error('Web Bluetooth API is not supported in this browser.');
            }

            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [NUS_SERVICE_UUID] }],
                optionalServices: [NUS_SERVICE_UUID]
            });

            if (!this.device) {
                return false;
            }

            this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());

            this.server = await this.device.gatt.connect();
            const service = await this.server.getPrimaryService(NUS_SERVICE_UUID);

            this.txCharacteristic = await service.getCharacteristic(NUS_TX_CHAR_UUID);
            this.rxCharacteristic = await service.getCharacteristic(NUS_RX_CHAR_UUID);

            await this.rxCharacteristic.startNotifications();
            this.rxCharacteristic.addEventListener('characteristicvaluechanged', (e) => this._onRxValue(e));

            this.isConnected = true;
            this._notifyStatusChange();
            this._log('BLE 연결됨 (Nordic UART Service)', 'success');
            return true;
        } catch (error) {
            if (error.name !== 'NotFoundError') {
                this._log(`연결 실패: ${error.message}`, 'error');
            }
            this.isConnected = false;
            this._cleanup();
            this._notifyStatusChange();
            return false;
        }
    }

    /**
     * 자동 재연결 시도 — Web Bluetooth는 이전 기기 목록이 없어 연결 다이얼로그를 다시 띄움
     */
    async autoConnect(_baudRate = 115200) {
        if (!navigator.bluetooth) {
            console.warn('[SerialController] Web Bluetooth not supported, skip autoConnect');
            return false;
        }
        return await this.connect(_baudRate);
    }

    _onDisconnected() {
        this._log('기기 연결 끊김', 'info');
        this.isConnected = false;
        this._cleanup();
        this._notifyStatusChange();
    }

    _cleanup() {
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        if (this.server && this.server.connected) {
            try { this.server.disconnect(); } catch (_) {}
        }
        this.server = null;
        this.device = null;
    }

    _onRxValue(event) {
        const value = event.target.value;
        if (!value) return;
        const decoder = new TextDecoder();
        const text = decoder.decode(value);
        this._log(`수신: ${text}`, 'received');
    }

    async disconnect() {
        try {
            this.isConnected = false;
            if (this.server && this.server.connected) {
                this.server.disconnect();
            }
            this._cleanup();
            this._notifyStatusChange();
            this._log('연결 해제됨', 'info');
        } catch (error) {
            this._log(`연결 해제 실패: ${error.message}`, 'error');
            this._cleanup();
            this._notifyStatusChange();
        }
    }

    async sendCommand(command) {
        if (!this.isConnected || !this.txCharacteristic) {
            this._log('연결되지 않음 — 명령 무시: ' + command, 'error');
            return false;
        }
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(command);
            await this.txCharacteristic.writeValue(data);
            this._log('명령 전송: ' + command, 'sent');
            return true;
        } catch (error) {
            this._log('명령 전송 실패: ' + error.message, 'error');
            return false;
        }
    }

    /** raw 바이트 전송 (제어 문자 등) — 테스트/디버그용 */
    async sendRaw(bytes) {
        if (!this.isConnected || !this.txCharacteristic) {
            this._log('연결되지 않음', 'error');
            return false;
        }
        try {
            const data = new Uint8Array(bytes);
            await this.txCharacteristic.writeValue(data);
            return true;
        } catch (error) {
            this._log('전송 실패: ' + error.message, 'error');
            return false;
        }
    }

    async accelerate() {
        return await this.sendCommand('i');
    }

    async decelerate() {
        return await this.sendCommand('o');
    }

    async turnOff() {
        return await this.sendCommand('x');
    }

    getConnectionStatus() {
        return this.isConnected;
    }

    _notifyStatusChange() {
        if (this.onStatusChange) {
            this.onStatusChange(this.isConnected);
        }
    }
}
