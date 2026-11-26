/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Honda K-Line Telemetry - Ban toi gian theo loi goc chay muot
  ******************************************************************************
  */
/* USER CODE END Header */
#include "main.h"

/* USER CODE BEGIN Includes */
#include <string.h>
/* USER CODE END Includes */

UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;

void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);

/* USER CODE BEGIN 0 */
#define POLL_REST_MS  100U   /* Nghi 100ms giua cac goi -> tong chu ky ~135-160ms (~6-7 Hz muot) */
#define WAIT_RESP_MS  65U    /* Cho toi da 65ms cho phan hoi ECU */

typedef enum {
    CMD_NONE = 0,
    CMD_WAKEUP,
    CMD_DTC,
    CMD_CLEAR_DTC,
    CMD_ECMID,
    CMD_PROBE
} KlineCmd_t;

uint8_t rx_byte = 0;
uint8_t rx_buffer[128];
volatile uint8_t rx_index = 0;

uint8_t rx2_byte = 0;
uint8_t rx2_buffer[32];
volatile uint8_t rx2_index = 0;
volatile KlineCmd_t cmd_pending = CMD_NONE;
volatile uint8_t probe_table = 0x11;

uint8_t req_wakeup[]   = {0xFE, 0x04, 0x72, 0x8C};
uint8_t req_init[]     = {0x72, 0x05, 0x00, 0xF0, 0x99};
uint8_t req_table11[]  = {0x72, 0x05, 0x71, 0x11, 0x07};
uint8_t req_ecmid[]    = {0x72, 0x05, 0x71, 0x00, 0x18};
uint8_t req_dtc_cur[]  = {0x72, 0x05, 0x71, 0x73, 0xA5};
uint8_t req_dtc_hist[] = {0x72, 0x05, 0x71, 0x74, 0xA4};
uint8_t req_clear_dtc[]= {0x72, 0x05, 0x60, 0x00, 0x29};

static void KLine_IwdgInit(void) {
    IWDG->KR = 0x5555U;
    IWDG->PR = 0x06U;   /* LSI ~40kHz / 256 = 156.25 Hz */
    IWDG->RLR = 312U;   /* ~2.0s timeout */
    IWDG->KR = 0xAAAAU;
    IWDG->KR = 0xCCCCU;
}

static void KLine_IwdgRefresh(void) {
    IWDG->KR = 0xAAAAU;
}

static uint8_t KLine_HexNibble(char c) {
    if (c >= '0' && c <= '9') return (uint8_t)(c - '0');
    if (c >= 'A' && c <= 'F') return (uint8_t)(c - 'A' + 10);
    if (c >= 'a' && c <= 'f') return (uint8_t)(c - 'a' + 10);
    return 0xFFU;
}

static void KLine_FastInit(void) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    HAL_UART_DeInit(&huart1);

    GPIO_InitStruct.Pin = GPIO_PIN_9;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_9, GPIO_PIN_RESET);
    HAL_Delay(70);
    KLine_IwdgRefresh();

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_9, GPIO_PIN_SET);
    HAL_Delay(120);
    KLine_IwdgRefresh();

    MX_USART1_UART_Init();
}

static void KLine_WaitResponse(uint8_t echo_len, uint16_t max_ms) {
    uint32_t start = HAL_GetTick();
    while ((HAL_GetTick() - start) < max_ms) {
        uint8_t idx = rx_index;
        if (idx > (uint8_t)(echo_len + 1U)) {
            uint8_t ecu_len = rx_buffer[echo_len + 1U];
            if (ecu_len >= 4U && ecu_len <= 64U && idx >= (uint8_t)(echo_len + ecu_len)) {
                break;
            }
        }
        HAL_Delay(2);
    }
}

static void KLine_FlushRxToPC(uint8_t echo_len) {
    static char tx_buf[420];
    uint8_t local_buf[sizeof(rx_buffer)];
    uint8_t len = 0;

    __disable_irq();
    len = rx_index;
    if (len > 0U) {
        memcpy(local_buf, rx_buffer, len);
        rx_index = 0;
    }
    __enable_irq();

    if (len <= echo_len || len < 4U) {
        return;
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
    tx_buf[pos++] = '\r';
    tx_buf[pos++] = '\n';

    HAL_UART_Transmit(&huart2, (uint8_t *)tx_buf, pos, 100);
}

static void KLine_RunHandshake(void) {
    const char msg1[] = "Dang danh thuc ECU (Fast Init)...\r\n";
    const char msg2[] = "Gui ma Wake up...\r\n";
    const char msg3[] = "Gui ma Init...\r\n";
    const char msg4[] = "Hoan tat khoi tao! Bat dau doc Table 11.\r\n";

    HAL_UART_Transmit(&huart2, (uint8_t *)msg1, sizeof(msg1) - 1U, 100);
    KLine_FastInit();
    HAL_Delay(50);

    __HAL_UART_CLEAR_OREFLAG(&huart1);
    __disable_irq();
    rx_index = 0;
    __enable_irq();
    HAL_UART_Receive_IT(&huart1, &rx_byte, 1);

    HAL_UART_Transmit(&huart2, (uint8_t *)msg2, sizeof(msg2) - 1U, 100);
    HAL_UART_Transmit(&huart1, req_wakeup, sizeof(req_wakeup), 100);
    HAL_Delay(100);

    HAL_UART_Transmit(&huart2, (uint8_t *)msg3, sizeof(msg3) - 1U, 100);
    HAL_UART_Transmit(&huart1, req_init, sizeof(req_init), 100);
    HAL_Delay(100);

    __disable_irq();
    rx_index = 0;
    __enable_irq();

    HAL_UART_Transmit(&huart2, (uint8_t *)msg4, sizeof(msg4) - 1U, 100);
}

static void KLine_SendRequestAndFlush(const uint8_t *req, uint8_t req_len, uint16_t wait_ms) {
    if (huart1.RxState == HAL_UART_STATE_READY) {
        __HAL_UART_CLEAR_OREFLAG(&huart1);
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    }

    __disable_irq();
    rx_index = 0;
    __enable_irq();

    HAL_UART_Transmit(&huart1, (uint8_t *)req, req_len, 100);
    KLine_WaitResponse(req_len, wait_ms);
    KLine_FlushRxToPC(req_len);
}
/* USER CODE END 0 */

int main(void)
{
  HAL_Init();
  SystemClock_Config();

  MX_GPIO_Init();
  MX_USART1_UART_Init();
  MX_USART2_UART_Init();

  /* USER CODE BEGIN 2 */
  __HAL_UART_CLEAR_OREFLAG(&huart2);
  HAL_UART_Receive_IT(&huart2, &rx2_byte, 1);

  KLine_IwdgInit();
  KLine_RunHandshake();
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    KLine_IwdgRefresh();

    if (cmd_pending != CMD_NONE) {
        KlineCmd_t cmd = cmd_pending;
        cmd_pending = CMD_NONE;
        if (cmd == CMD_WAKEUP) {
            KLine_RunHandshake();
        } else if (cmd == CMD_ECMID) {
            KLine_SendRequestAndFlush(req_ecmid, sizeof(req_ecmid), WAIT_RESP_MS);
        } else if (cmd == CMD_DTC) {
            KLine_SendRequestAndFlush(req_dtc_cur, sizeof(req_dtc_cur), WAIT_RESP_MS);
            HAL_Delay(20);
            KLine_SendRequestAndFlush(req_dtc_hist, sizeof(req_dtc_hist), WAIT_RESP_MS);
        } else if (cmd == CMD_CLEAR_DTC) {
            KLine_SendRequestAndFlush(req_clear_dtc, sizeof(req_clear_dtc), WAIT_RESP_MS);
        } else if (cmd == CMD_PROBE) {
            uint8_t tbl = probe_table;
            uint8_t cs = (uint8_t)(256U - ((0x72U + 0x05U + 0x71U + tbl) & 0xFFU));
            uint8_t req_probe[5] = {0x72, 0x05, 0x71, tbl, cs};
            KLine_SendRequestAndFlush(req_probe, sizeof(req_probe), WAIT_RESP_MS);
        }
    }

    KLine_SendRequestAndFlush(req_table11, sizeof(req_table11), WAIT_RESP_MS);

    /* Nghi de bus tho roi hoi tiep */
    HAL_Delay(POLL_REST_MS);
    /* USER CODE END 3 */
  }
}

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

static void MX_GPIO_Init(void)
{
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART1) {
        if (rx_index < sizeof(rx_buffer)) {
            rx_buffer[rx_index++] = rx_byte;
        }
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    }
    else if (huart->Instance == USART2) {
        if (rx2_byte == '\n' || rx2_byte == '\r') {
            if (rx2_index > 0U) {
                rx2_buffer[rx2_index] = '\0';
                char *cmd = (char *)rx2_buffer;
                if (strstr(cmd, "WAKEUP") != NULL) {
                    cmd_pending = CMD_WAKEUP;
                } else if (strstr(cmd, "CLEARDTC") != NULL) {
                    cmd_pending = CMD_CLEAR_DTC;
                } else if (strstr(cmd, "DTC") != NULL) {
                    cmd_pending = CMD_DTC;
                } else if (strstr(cmd, "ECMID") != NULL) {
                    cmd_pending = CMD_ECMID;
                } else {
                    char *p = strstr(cmd, "PROBE ");
                    if (p != NULL) {
                        uint8_t hi = KLine_HexNibble(p[6]);
                        uint8_t lo = KLine_HexNibble(p[7]);
                        if (hi != 0xFFU && lo != 0xFFU) {
                            probe_table = (uint8_t)((hi << 4) | lo);
                            cmd_pending = CMD_PROBE;
                        }
                    }
                }
                rx2_index = 0;
            }
        } else if (rx2_index < (sizeof(rx2_buffer) - 1U)) {
            rx2_buffer[rx2_index++] = rx2_byte;
        } else {
            rx2_index = 0;
        }
        HAL_UART_Receive_IT(&huart2, &rx2_byte, 1);
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
    huart->ErrorCode = HAL_UART_ERROR_NONE;
    huart->RxState = HAL_UART_STATE_READY;

    if (huart->Instance == USART1) {
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    } else if (huart->Instance == USART2) {
        HAL_UART_Receive_IT(&huart2, &rx2_byte, 1);
    }
}
/* USER CODE END 4 */

void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}
