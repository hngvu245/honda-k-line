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
#define POLL_REST_MS  100U   /* Nghi 100ms giua cac goi -> tong chu ky ~160ms (~6 Hz muot) */

uint8_t rx_byte = 0;
uint8_t rx_buffer[100];
volatile uint8_t rx_index = 0;

uint8_t rx2_byte = 0;
uint8_t rx2_buffer[32];
volatile uint8_t rx2_index = 0;
volatile uint8_t wakeup_pending = 0;

uint8_t req_wakeup[]  = {0xFE, 0x04, 0x72, 0x8C};
uint8_t req_init[]    = {0x72, 0x05, 0x00, 0xF0, 0x99};
uint8_t req_table11[] = {0x72, 0x05, 0x71, 0x11, 0x07};

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

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_9, GPIO_PIN_SET);
    HAL_Delay(120);

    MX_USART1_UART_Init();
}

static void KLine_FlushRxToPC(void) {
    static char tx_buf[350];
    uint8_t local_buf[sizeof(rx_buffer)];
    uint8_t len = 0;

    __disable_irq();
    len = rx_index;
    if (len > 0U) {
        memcpy(local_buf, rx_buffer, len);
        rx_index = 0;
    }
    __enable_irq();

    if (len < 4U) {
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

  KLine_RunHandshake();
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    if (wakeup_pending) {
        wakeup_pending = 0;
        KLine_RunHandshake();
    }

    /* Dam bao ngat RX luon song truoc khi gui */
    if (huart1.RxState == HAL_UART_STATE_READY) {
        __HAL_UART_CLEAR_OREFLAG(&huart1);
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    }

    __disable_irq();
    rx_index = 0;
    __enable_irq();

    /* 1. Gui 5 byte hoi Table 11 (de 5 byte Echo vao buffer binh thuong) */
    HAL_UART_Transmit(&huart1, req_table11, sizeof(req_table11), 100);

    /* 2. Cho du 45ms cho ca 5 byte Echo + 25 byte ECU ve tron goi */
    HAL_Delay(45);

    /* 3. Day nguyen 30 byte len PC (dashboard.py tu tach header 02 19 71 11) */
    KLine_FlushRxToPC();

    /* 4. Nghi de bus tho roi hoi tiep */
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
                if (strstr((char *)rx2_buffer, "WAKEUP") != NULL) {
                    wakeup_pending = 1;
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
