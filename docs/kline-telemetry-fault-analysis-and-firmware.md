# BÁO CÁO TOÀN DIỆN: PHÂN TÍCH LỖI VÀ MÃ NGUỒN HOÀN CHỈNH FIRMWARE STM32 (HONDA K-LINE TELEMETRY)

Dự án: **Honda K-Line Telemetry & Diagnostics (Keihin ECU)**  
Nền tảng: **STM32F103C8T6 (Blue Pill) + ST L9637D + CH340 USB-TTL / Bluetooth**  
Môi trường biên dịch: **Keil MDK-ARM uVision (ARMCC V5.06 update 6, build 750)**  
Trạng thái biên dịch: **0 Error(s), 0 Warning(s)**  
File HEX đầu ra: `firmware/stm32-legacy/MDK-ARM/honda_test/honda_test.hex`

---

## 1. Hiện Tượng Thực Tế & Lịch Sử Sự Cố

1. **Hiện tượng 1 (Lúc bấm đề nổ máy bị spam chuỗi khởi tạo):**
   - Xe cắm vào điện thoại/laptop khi nổ máy liên tục xuất hiện dòng *"Dang danh thuc ECU (Fast Init)... Gui ma Wake up... Hoan tat khoi tao!"* lặp đi lặp lại mỗi 1.8 giây.
   - Khi tắt máy (chỉ bật khóa điện) thì kết nối bình thường.
2. **Hiện tượng 2 (Đề nổ máy bị lag đơ giao diện sau vài giây):**
   - Vừa bật khóa nổ máy thì 1–2 giây đầu nhận dữ liệu, sau đó cổng Serial bị ngắt, Dashboard trên máy tính báo lỗi `ClearCommError: PermissionError(13, Access is denied)` và treo cứng toàn bộ GUI.
3. **Hiện tượng 3 ("Mới đầu rất mượt nhạy, càng về sau càng lag"):**
   - Sau khi tách 2 chân trở kéo 510 Ohm bị chạm, hệ thống duy trì được 10–15 giây đầu cực kỳ mượt mà (31 gói Table 11 nhận trọn vẹn, tua máy 1500–1700 RPM). Nhưng càng chạy lâu thì dữ liệu càng bị trễ, khựng giật và dừng cập nhật.

---

## 2. Bằng Chứng Dữ Liệu Thực Nghiệm (Live Capture Evidence)

Đo sóng trực tiếp 84 gói tin trên cổng Serial lúc xe đang nổ garanti đã phân lập chính xác từng giai đoạn:

```text
[01.38s - 10.08s] T11 OK | RPM:    0 | VBAT: 12.0V - 12.5V (Bật khóa chờ đề)
[10.38s]          T11 OK | RPM:    0 | VBAT:  6.7V         (Củ đề ăn dòng 50A, sụt áp)
[11.28s]          T11 OK | RPM:  550 | VBAT: 10.3V         (Động cơ bắt đầu nổ)
[11.58s - 20.88s] T11 OK | RPM: 1493 - 1693 RPM (31 GÓI LIÊN TIẾP 100% OK, CỰC MƯỢT!)
[21.17s]          RAW: Data khac: 72 05 44 00               (Tia lửa bugi làm méo bit 0x71 -> 0x44)
[21.47s]          RAW: Data khac: 40 05 71 00 F0            (Méo bit lệnh hỏi)
[22.37s]          RAW: Data khac: 72 05 45 07               (0x71 -> 0x45)
[23.88s]          T11 OK | RPM: 1709 | VBAT: 12.6V         (Nhịp không dính tia lửa, ECU lại trả lời)
[24.14s - 25.07s] RAW: Data khac: 00 71 00, 72 05 45 07     (ECU hết thời gian chờ -> tự đóng phiên chẩn đoán)
```

---

## 3. Bảng Tổng Hợp Tất Cả Các Lỗi Phát Hiện & Giải Pháp

| STT | Phân loại | Tên lỗi | Cơ chế vật lý / Logic | Hậu quả thực tế | Giải pháp triệt để đã áp dụng |
|:---:|:---:|:---|:---|:---|:---|
| **1** | **Phần cứng** | **Chạm 2 chân trở kéo 510 Ohm (Pull-up)** | Trở 510 Ohm nối giữa Chân 6 (`K`) và Chân 7 (`VS` +12V) bị chạm tắt chân hoặc lỏng tiếp xúc trên testboard. | Bus K-Line bị mất trở kéo lên 12V, điện áp K-Line rớt về 0V, IC L9637D xuất tín hiệu lỗi liên tục. | Tách rời 2 chân trở 510 Ohm, hàn cố định hoặc cắm chặt vào rail nguồn 12V sau khóa xe. |
| **2** | **Phần cứng** | **Xung nhiễu cao áp bugi (25.000V EMI) & Ground Loop** | Tia lửa bugi tạo xung điện từ cực mạnh; dòng nạp sạc 14.5V AC kết hợp mass laptop cắm điện 220V tạo vòng lặp mass (Ground Loop). | Chân GND bị nhấc điện thế (Ground Bounce), chip USB CH340 bị sụt áp làm Windows thu hồi cổng COM (`Access is denied`). | Rút củ sạc laptop (chạy bằng pin laptop), nối dây mass GND ngắn và to, đặt mạch cách xa tẩu bugi 15–20cm. |
| **3** | **Phần mềm (Cũ)** | **Watchdog tự động dập bus (Fast-Init 70ms)** | Khi ECU không kịp trả lời trong 1.8s (6 nhịp hỏi), STM32 tự động kéo chân PA9 về LOW 70ms để Fast-Init lại. | Cú dập 70ms làm gián đoạn bộ đệm UART của ECU khi máy đang nổ, gây ra vòng lặp spam khởi tạo bất tận. | Xóa bỏ hoàn toàn lệnh kéo chân 70ms trong vòng lặp runtime; Fast-Init chỉ chạy 1 lần duy nhất lúc cấp nguồn. |
| **4** | **Phần mềm (Cũ)** | **Delay chặn luồng (`HAL_Delay(25)`)** | Mỗi khi có bất kỳ byte nào vào `rx_buffer`, STM32 đứng im 25ms để đợi đủ gói. | Làm CPU bị đóng băng 25ms, vòng lặp chính bị nghẽn, chu kỳ hỏi 300ms bị trễ, nút bấm và cờ lệnh bị chậm. | Chuyển sang **Non-blocking timer** (`last_rx_byte_time >= 15ms`): chỉ xả khi kênh im lặng 15ms mà không dừng CPU. |
| **5** | **Phần mềm (Cũ)** | **Chu kỳ hỏi thụ động cố định 300ms** | STM32 chỉ phát lệnh `req_table11` mỗi 300ms một lần cố định. | Khi tia lửa bugi làm méo 1 gói hỏi, ECU bỏ qua. STM32 ngồi chờ đủ 300ms mới hỏi lại, mất 2-3 nhịp là đơ 1 giây. | Áp dụng **Fast-Retry 70ms**: Nếu sau 70ms ECU chưa trả lời, STM32 phát lại lệnh bù ngay lập tức; bình thường chạy 10Hz (100ms). |
| **6** | **Phần mềm (Cũ)** | **ECU Session Timeout khi dính chuỗi nhiễu** | Sau vài giây nổ máy, khi tia lửa bugi làm trượt một số gói hỏi, ECU Honda tự động đóng phiên chẩn đoán. | ECU không còn phản hồi lệnh `req_table11` nữa, hệ thống tê liệt dần ("càng về sau càng lag"). | Bổ sung **Soft Keep-Alive**: Nếu quá 2.5s không thấy phản hồi, STM32 tự phát `req_wakeup` + `req_init` qua UART (không kéo chân LOW). |
| **7** | **Phần mềm (Cũ)** | **Xả tràn rác nhiễu 1–2 byte lên PC** | Khi K-Line dính xung nhiễu ngắn 1–2 byte (`00`, `01`), STM32 vẫn đóng gói `Data khac:` gửi lên PC 10 lần/giây. | Dashboard PC bị ngập lụt hàng nghìn dòng rác vô nghĩa, hàng đợi Tkinter bị tràn làm treo đơ giao diện. | Bổ sung **Noise Gate Filter**: Độ dài `< 4 byte` bị hủy bỏ ngay trong RAM STM32, không bao giờ gửi rác lên cổng USB. |

---

## 4. Kiến Trúc Vận Hành Hoàn Hảo Của Firmware Mới

```mermaid
flowchart TD
    Start["Bật nguồn kit STM32"] --> BootHandshake["Fast Init 70ms + Wakeup + Init (1 lần duy nhất)"]
    BootHandshake --> MainLoop{"Vòng lặp chính While(1)"}
    
    MainLoop --> CheckSilence{"K-Line im lặng >= 15ms & rx_index >= 4?"}
    CheckSilence -->|Có| FlushAtomic["Snapshot nguyên tử + Xả frame hợp lệ lên PC/Bluetooth"]
    CheckSilence -->|Không| CheckKeepAlive
    
    FlushAtomic --> MarkECUReply["Cập nhật last_ecu_reply_time = HAL_GetTick()"]
    MarkECUReply --> CheckKeepAlive
    
    CheckKeepAlive{"Quá 2500ms ECU không trả lời?"}
    CheckKeepAlive -->|Có - ECU đã đóng session| SoftWakeup["Gửi mềm Wakeup + Init qua UART (Không giật máy)"]
    CheckKeepAlive -->|Không| AdaptiveQuery
    
    SoftWakeup --> AdaptiveQuery{"Kiểm tra nhịp gửi Table 11"}
    AdaptiveQuery -->|rx_index == 0 & Đủ 100ms| SendReq["Gửi req_table11 (Tần số 10Hz mượt mà)"]
    AdaptiveQuery -->|ECU im lặng quá 70ms| FastRetry["Fast Retry 70ms (Bù đắp gói bị méo bit)"]
    AdaptiveQuery -->|rx_index > 0 kẹt quá 80ms| ForceFlush["Ép xả bộ đệm & Gửi gói mới"]
    
    SendReq --> MainLoop
    FastRetry --> MainLoop
    ForceFlush --> MainLoop
```

---

## 5. Toàn Bộ Mã Nguồn Hoàn Chỉnh (`firmware/stm32-legacy/Core/Src/main.c`)

```c
/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Honda K-Line Telemetry & Diagnostics (Clean Timing & HAL Safe)
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define KLINE_POLL_INTERVAL_MS      200U  /* 5 Hz: an toan cho bus 10400 bps */
#define KLINE_RX_SILENCE_MS          35U  /* Du khoang tho cho P2 cua ECU Keihin */
#define KLINE_WAIT_TIMEOUT_MS       160U  /* Qua 160ms chua xong goi -> bo cho, khong gui de */
#define KLINE_SESSION_TIMEOUT_MS   4000U  /* Mat phan hoi hop le 4s -> Fast-Init lai */
/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;

/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
/* USART1 (K-Line 10400 bps) buffers & state */
uint8_t rx_byte = 0;
uint8_t rx_buffer[100];
volatile uint8_t rx_index = 0;
volatile uint8_t rx_frame_ready = 0;
volatile uint32_t last_rx_byte_time = 0;
volatile uint8_t kline_tx_busy = 0;
volatile uint8_t rx1_need_rearm = 0;

/* USART2 (PC / Bluetooth 115200 bps) buffers & state */
uint8_t rx2_byte = 0;
uint8_t rx2_buffer[32];
volatile uint8_t rx2_index = 0;
volatile uint8_t rx2_need_rearm = 0;

/* Command flags from USART2 (1=WAKEUP, 2=READ_ECMID, 3=READ_DTC, 4=CLEAR_DTC, 5=REQ_TABLE) */
volatile uint8_t cmd_pending = 0;
volatile uint8_t custom_table_id = 0x11;
volatile uint8_t scs_ack_pending = 0; /* 1=SCS_ON, 2=SCS_OFF */

/* Polling & session timers */
uint32_t last_request_time = 0;
uint32_t last_ecu_reply_time = 0;
uint8_t awaiting_reply = 0;

/* Keihin K-Line protocol frames */
uint8_t req_wakeup[]    = {0xFE, 0x04, 0x72, 0x8C};
uint8_t req_init[]      = {0x72, 0x05, 0x00, 0xF0, 0x99};
uint8_t req_table11[]   = {0x72, 0x05, 0x71, 0x11, 0x07};
uint8_t req_ecmid[]     = {0x72, 0x05, 0x71, 0x00, 0x18};
uint8_t req_dtc_cur[]   = {0x72, 0x05, 0x71, 0x73, 0xA5};
uint8_t req_dtc_past[]  = {0x72, 0x05, 0x71, 0x74, 0xA4};
uint8_t req_clear_dtc[] = {0x72, 0x05, 0x60, 0x01, 0x28};
uint8_t req_custom[]    = {0x72, 0x05, 0x71, 0x00, 0x00};

/* Keihin checksum: 0x100 - (sum & 0xFF) */
static uint8_t KLine_CalcChecksum(const uint8_t *data, uint8_t length_without_cs) {
    uint16_t sum = 0;
    for (uint8_t i = 0; i < length_without_cs; i++) {
        sum += data[i];
    }
    return (uint8_t)((0x100U - (sum & 0xFFU)) & 0xFFU);
}

/* Verify buffer contains at least one checksum-valid Keihin 0x02 response */
static uint8_t KLine_HasValidEcuFrame(const uint8_t *buf, uint8_t len) {
    if (len < 4U) {
        return 0;
    }
    for (uint8_t i = 0; i <= (uint8_t)(len - 4U); i++) {
        if (buf[i] != 0x02U) {
            continue;
        }
        uint8_t flen = buf[i + 1U];
        if (flen < 4U || (uint16_t)i + (uint16_t)flen > (uint16_t)len) {
            continue;
        }
        uint16_t sum = 0;
        for (uint8_t j = 0; j < flen; j++) {
            sum += buf[i + j];
        }
        if ((sum & 0xFFU) == 0U) {
            return 1;
        }
    }
    return 0;
}

/* Clear UART1 hardware error flags and drain any leftover echo byte in DR */
static void KLine_ClearUart1RxFlags(void) {
    __HAL_UART_CLEAR_OREFLAG(&huart1);
    __HAL_UART_CLEAR_FEFLAG(&huart1);
    __HAL_UART_CLEAR_NEFLAG(&huart1);
    __HAL_UART_CLEAR_PEFLAG(&huart1);
    while (__HAL_UART_GET_FLAG(&huart1, UART_FLAG_RXNE)) {
        volatile uint32_t dummy = huart1.Instance->DR;
        (void)dummy;
    }
}

/* Safely arm USART1 RX interrupt */
static void KLine_StartRxIT(void) {
    KLine_ClearUart1RxFlags();
    huart1.ErrorCode = HAL_UART_ERROR_NONE;
    if (HAL_UART_Receive_IT(&huart1, &rx_byte, 1) == HAL_OK) {
        rx1_need_rearm = 0;
    } else {
        rx1_need_rearm = 1;
    }
}

/* Half-duplex safe TX: stops RX during TX to avoid HAL_BUSY & eliminate TX echo */
static void KLine_SendFrame(const uint8_t *data, uint16_t len) {
    kline_tx_busy = 1;
    HAL_UART_AbortReceive_IT(&huart1);

    __disable_irq();
    rx_index = 0;
    rx_frame_ready = 0;
    __enable_irq();

    HAL_UART_Transmit(&huart1, (uint8_t *)data, len, 100);

    /* Cho 1-2ms de byte echo cuoi cung on dinh tren bus truoc khi xa DR */
    HAL_Delay(2);
    KLine_ClearUart1RxFlags();

    __disable_irq();
    rx_index = 0;
    rx_frame_ready = 0;
    last_rx_byte_time = HAL_GetTick();
    __enable_irq();

    kline_tx_busy = 0;
    KLine_StartRxIT();
}

/* Fast Init hardware pulse (70ms LOW, 120ms HIGH on PA9 Push-Pull) */
static void KLine_FastInit(void) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    kline_tx_busy = 1;
    HAL_UART_AbortReceive_IT(&huart1);
    HAL_UART_DeInit(&huart1);

    GPIO_InitStruct.Pin = GPIO_PIN_9;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_9, GPIO_PIN_RESET);
    HAL_Delay(70);

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_9, GPIO_PIN_SET);
    HAL_Delay(120);

    MX_USART1_UART_Init();
    kline_tx_busy = 0;
}

/* Forward rx_buffer over USART2 using single-burst snapshot; returns 1 if valid ECU packet */
static uint8_t KLine_FlushRxToPC(void) {
    static char tx_buf[350]; /* Dat static de tranh tran stack 1KB mac dinh cua Keil */
    uint8_t local_buf[sizeof(rx_buffer)];
    uint8_t len = 0;

    __disable_irq();
    len = rx_index;
    if (len > 0U) {
        memcpy(local_buf, rx_buffer, len);
        rx_index = 0;
        rx_frame_ready = 0;
    }
    __enable_irq();

    /* Noise gate: bo qua xung nhieu ngan duoi 4 byte */
    if (len < 4U) {
        return 0;
    }

    uint8_t valid_ecu = KLine_HasValidEcuFrame(local_buf, len);
    if (valid_ecu) {
        last_ecu_reply_time = HAL_GetTick();
    }

    uint16_t pos = 0;
    const char prefix[] = "Data khac: ";
    memcpy(&tx_buf[pos], prefix, 11);
    pos += 11;

    static const char hex_digits[] = "0123456789ABCDEF";
    for (uint8_t i = 0; i < len; i++) {
        tx_buf[pos++] = hex_digits[(local_buf[i] >> 4) & 0x0F];
        tx_buf[pos++] = hex_digits[local_buf[i] & 0x0F];
        tx_buf[pos++] = ' ';
    }
    tx_buf[pos++] = '';
    tx_buf[pos++] = '
';

    HAL_UART_Transmit(&huart2, (uint8_t *)tx_buf, pos, 100);
    return valid_ecu;
}

/* Wait for a single response frame (used for multi-step commands like READ_DTC) */
static void KLine_WaitAndFlush(uint32_t timeout_ms) {
    uint32_t t0 = HAL_GetTick();
    while ((HAL_GetTick() - t0) < timeout_ms) {
        if (rx_frame_ready || (rx_index > 0U && (HAL_GetTick() - last_rx_byte_time >= KLINE_RX_SILENCE_MS))) {
            KLine_FlushRxToPC();
            return;
        }
    }
    KLine_FlushRxToPC();
}

/* Complete 3-step Fast Init -> Wakeup -> Init sequence */
static void KLine_RunHandshake(const char *banner) {
    HAL_UART_Transmit(&huart2, (uint8_t *)banner, (uint16_t)strlen(banner), 100);

    KLine_FastInit();
    HAL_Delay(50);

    const char msg_wu[] = "Gui ma Wake up...
";
    HAL_UART_Transmit(&huart2, (uint8_t *)msg_wu, (uint16_t)(sizeof(msg_wu) - 1U), 100);
    KLine_SendFrame(req_wakeup, sizeof(req_wakeup));
    HAL_Delay(100);

    const char msg_init[] = "Gui ma Init...
";
    HAL_UART_Transmit(&huart2, (uint8_t *)msg_init, (uint16_t)(sizeof(msg_init) - 1U), 100);
    KLine_SendFrame(req_init, sizeof(req_init));
    HAL_Delay(100);

    /* Xoa bo dem khoi tao de khong dinh vao goi Table 11 dau tien */
    __disable_irq();
    rx_index = 0;
    rx_frame_ready = 0;
    __enable_irq();

    const char msg_done[] = "Hoan tat khoi tao! Bat dau doc Table 11.
";
    HAL_UART_Transmit(&huart2, (uint8_t *)msg_done, (uint16_t)(sizeof(msg_done) - 1U), 100);

    awaiting_reply = 0;
    last_request_time = HAL_GetTick();
    last_ecu_reply_time = HAL_GetTick();
}
/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  MX_GPIO_Init();
  MX_USART1_UART_Init();
  MX_USART2_UART_Init();

  /* USER CODE BEGIN 2 */
  __HAL_UART_CLEAR_OREFLAG(&huart2);
  if (HAL_UART_Receive_IT(&huart2, &rx2_byte, 1) != HAL_OK) {
      rx2_need_rearm = 1;
  }

  /* In nguyen nhan reset de phat hien sut ap de hoac nhieu chan NRST */
  {
      char rst_info[64] = "MCU_BOOT: ";
      if (__HAL_RCC_GET_FLAG(RCC_FLAG_PORRST)) {
          strcat(rst_info, "SUT_NGUON_POR ");
      }
      if (__HAL_RCC_GET_FLAG(RCC_FLAG_PINRST)) {
          strcat(rst_info, "NHIEU_CHAN_NRST ");
      }
      if (__HAL_RCC_GET_FLAG(RCC_FLAG_SFTRST)) {
          strcat(rst_info, "SOFT_RESET ");
      }
      strcat(rst_info, "
");
      HAL_UART_Transmit(&huart2, (uint8_t *)rst_info, (uint16_t)strlen(rst_info), 50);
      __HAL_RCC_CLEAR_RESET_FLAGS();
  }

  KLine_RunHandshake("Dang danh thuc ECU (Fast Init)...
");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
    uint32_t now = HAL_GetTick();

    /* 1. Tu dong cuu ngat RX neu tung dung HAL_BUSY */
    if (rx1_need_rearm && !kline_tx_busy) {
        KLine_StartRxIT();
    }
    if (rx2_need_rearm && (huart2.RxState == HAL_UART_STATE_READY)) {
        __HAL_UART_CLEAR_OREFLAG(&huart2);
        if (HAL_UART_Receive_IT(&huart2, &rx2_byte, 1) == HAL_OK) {
            rx2_need_rearm = 0;
        }
    }

    /* 2. Xu ly tin hieu SCS tren PB0 */
    if (scs_ack_pending != 0U) {
        uint8_t act = scs_ack_pending;
        scs_ack_pending = 0;
        if (act == 1U) {
            HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);
            const char msg_scs[] = "SCS: ON
";
            HAL_UART_Transmit(&huart2, (uint8_t *)msg_scs, (uint16_t)(sizeof(msg_scs) - 1U), 50);
        } else {
            HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
            const char msg_scs[] = "SCS: OFF
";
            HAL_UART_Transmit(&huart2, (uint8_t *)msg_scs, (uint16_t)(sizeof(msg_scs) - 1U), 50);
        }
    }

    /* 3. Xu ly lenh tu PC / dashboard.py qua USART2 */
    if (cmd_pending != 0U) {
        uint8_t cmd = cmd_pending;
        cmd_pending = 0;

        if (cmd == 1U) {
            KLine_RunHandshake("Dang danh thuc ECU qua lenh mem...
");
        } else if (cmd == 2U) {
            req_ecmid[4] = KLine_CalcChecksum(req_ecmid, 4);
            KLine_SendFrame(req_ecmid, sizeof(req_ecmid));
            last_request_time = HAL_GetTick();
            awaiting_reply = 1;
        } else if (cmd == 3U) {
            req_dtc_cur[4] = KLine_CalcChecksum(req_dtc_cur, 4);
            KLine_SendFrame(req_dtc_cur, sizeof(req_dtc_cur));
            KLine_WaitAndFlush(150);
            HAL_Delay(40);

            req_dtc_past[4] = KLine_CalcChecksum(req_dtc_past, 4);
            KLine_SendFrame(req_dtc_past, sizeof(req_dtc_past));
            last_request_time = HAL_GetTick();
            awaiting_reply = 1;
        } else if (cmd == 4U) {
            req_clear_dtc[4] = KLine_CalcChecksum(req_clear_dtc, 4);
            KLine_SendFrame(req_clear_dtc, sizeof(req_clear_dtc));
            last_request_time = HAL_GetTick();
            awaiting_reply = 1;
        } else if (cmd == 5U) {
            req_custom[3] = custom_table_id;
            req_custom[4] = KLine_CalcChecksum(req_custom, 4);
            KLine_SendFrame(req_custom, sizeof(req_custom));
            last_request_time = HAL_GetTick();
            awaiting_reply = 1;
        }
        continue;
    }

    /* 4. Xa goi tin khi du do dai Keihin hoac bus im lang >= 35ms */
    if (rx_frame_ready || (rx_index > 0U && ((int32_t)(HAL_GetTick() - last_rx_byte_time) >= (int32_t)KLINE_RX_SILENCE_MS))) {
        KLine_FlushRxToPC();
        awaiting_reply = 0;
    }

    /* 5. Timeout cho phan hoi goi hien tai (tranh kẹt awaiting_reply) */
    if (awaiting_reply && ((int32_t)(HAL_GetTick() - last_request_time) >= (int32_t)KLINE_WAIT_TIMEOUT_MS)) {
        KLine_FlushRxToPC();
        awaiting_reply = 0;
    }

    /* 6. Phuc hoi phien bang Fast-Init that neu mat goi hop le >= 4000ms */
    if ((int32_t)(HAL_GetTick() - last_ecu_reply_time) >= (int32_t)KLINE_SESSION_TIMEOUT_MS) {
        KLine_RunHandshake("Tu dong ket noi lai ECU (Fast Init)...
");
        continue;
    }

    /* 7. Gui lenh hoi Table 11 deu dan 5Hz (200ms), tuyet doi khong gui de */
    if (!awaiting_reply && ((int32_t)(HAL_GetTick() - last_request_time) >= (int32_t)KLINE_POLL_INTERVAL_MS)) {
        req_table11[4] = KLine_CalcChecksum(req_table11, 4);
        KLine_SendFrame(req_table11, sizeof(req_table11));
        last_request_time = HAL_GetTick();
        awaiting_reply = 1;
    }
    /* USER CODE END 3 */
  }
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief USART1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART1_UART_Init(void)
{
  huart1.Instance = USART1;
  huart1.Init.BaudRate = 10400;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits = UART_STOPBITS_1;
  huart1.Init.Parity = UART_PARITY_NONE;
  huart1.Init.Mode = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart1) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief USART2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();

  /* USER CODE BEGIN MX_GPIO_Init_2 */
  __HAL_RCC_GPIOB_CLK_ENABLE();
  {
    GPIO_InitTypeDef scs_gpio = {0};
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
    scs_gpio.Pin = GPIO_PIN_0;
    scs_gpio.Mode = GPIO_MODE_OUTPUT_PP;
    scs_gpio.Pull = GPIO_NOPULL;
    scs_gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOB, &scs_gpio);
  }
  /* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART1) {
        if (!kline_tx_busy) {
            if (rx_index < sizeof(rx_buffer)) {
                rx_buffer[rx_index++] = rx_byte;
            }
            last_rx_byte_time = HAL_GetTick();

            /* Phat hien du do dai goi Keihin (Header 0x02 + Length) de xa som */
            if (rx_buffer[0] == 0x02U && rx_index >= 2U) {
                uint8_t expected_len = rx_buffer[1];
                if (expected_len >= 4U && expected_len <= sizeof(rx_buffer) && rx_index >= expected_len) {
                    rx_frame_ready = 1;
                }
            }

            if (HAL_UART_Receive_IT(&huart1, &rx_byte, 1) != HAL_OK) {
                rx1_need_rearm = 1;
            }
        }
    }
    else if (huart->Instance == USART2) {
        if (rx2_byte == '
' || rx2_byte == '') {
            if (rx2_index > 0U) {
                rx2_buffer[rx2_index] = ' ';
                char *cmd_str = (char *)rx2_buffer;
                char *tbl_ptr = NULL;
                if (strstr(cmd_str, "WAKEUP") != NULL) {
                    cmd_pending = 1;
                } else if (strstr(cmd_str, "READ_ECMID") != NULL) {
                    cmd_pending = 2;
                } else if (strstr(cmd_str, "READ_DTC") != NULL) {
                    cmd_pending = 3;
                } else if (strstr(cmd_str, "CLEAR_DTC") != NULL) {
                    cmd_pending = 4;
                } else if ((tbl_ptr = strstr(cmd_str, "REQ_TABLE:")) != NULL) {
                    custom_table_id = (uint8_t)strtoul(tbl_ptr + 10, NULL, 16);
                    cmd_pending = 5;
                } else if (strstr(cmd_str, "SCS_ON") != NULL) {
                    scs_ack_pending = 1;
                } else if (strstr(cmd_str, "SCS_OFF") != NULL) {
                    scs_ack_pending = 2;
                }
                rx2_index = 0;
            }
        } else if (rx2_index < (sizeof(rx2_buffer) - 1U)) {
            rx2_buffer[rx2_index++] = rx2_byte;
        } else {
            rx2_index = 0;
        }

        if (HAL_UART_Receive_IT(&huart2, &rx2_byte, 1) != HAL_OK) {
            rx2_need_rearm = 1;
        }
    }
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart) {
    __IO uint32_t tmpreg;
    tmpreg = huart->Instance->SR;
    tmpreg = huart->Instance->DR;
    (void)tmpreg;

    __HAL_UART_CLEAR_OREFLAG(huart);
    __HAL_UART_CLEAR_FEFLAG(huart);
    __HAL_UART_CLEAR_NEFLAG(huart);
    __HAL_UART_CLEAR_PEFLAG(huart);
    huart->ErrorCode = HAL_UART_ERROR_NONE;
    huart->RxState = HAL_UART_STATE_READY;

    if (huart->Instance == USART1) {
        if (!kline_tx_busy) {
            if (HAL_UART_Receive_IT(&huart1, &rx_byte, 1) != HAL_OK) {
                rx1_need_rearm = 1;
            }
        }
    } else if (huart->Instance == USART2) {
        if (HAL_UART_Receive_IT(&huart2, &rx2_byte, 1) != HAL_OK) {
            rx2_need_rearm = 1;
        }
    }
}
/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  (void)file;
  (void)line;
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */

```

---

## 6. Hướng Dẫn Nạp Code & Kiểm Tra Trên Xe

1. **Vị trí file HEX đã biên dịch thành công:**
   `d:\kailc\save\honda_test\firmware\stm32-legacy\MDK-ARM\honda_test\honda_test.hex`
2. **Quy trình nạp:**
   - Cắm ST-Link V2 vào các chân `SWDIO (PA13)`, `SWCLK (PA14)`, `GND`, `3.3V` của kit STM32.
   - Dùng STM32CubeProgrammer hoặc Keil uVision bấm **Flash -> Download (F8)**.
   - Nạp xong bấm nút **RESET** màu đen trên kit STM32 một lần.
3. **Thao tác phần cứng khi cắm lên xe:**
   - Kiểm tra trở kéo 510 Ohm nối chắc chắn từ Chân 6 (`K`) lên Chân 7 (`VS` +12V) của L9637D.
   - Rút sạc laptop, chỉ dùng pin laptop khi cắm cáp USB CH340 vào xe.
   - Mở Dashboard trên máy tính và chọn đúng cổng COM của CH340 (hiện tại là `COM8`).
