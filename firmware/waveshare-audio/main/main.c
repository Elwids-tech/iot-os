// Waveshare ESP32-S3-AUDIO-Board: seven WS2812 LEDs and ES8311 speaker output.
// Pin assignments verified against the manufacturer's board demo and schematic.
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/usb_serial_jtag.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "led_strip.h"

typedef struct {
    bool power, alarm_active;
    char color[8], mode[12], alarm_mode[12];
    int brightness, volume, alarm_duration;
} state_t;
static state_t state = {.color="#FF0000", .mode="solid", .alarm_mode="beep",
    .brightness=25, .volume=15, .alarm_duration=5};
static led_strip_handle_t leds;
static esp_codec_dev_handle_t codec;
static i2c_master_dev_handle_t expander;
static int64_t last_ping, alarm_until, alarm_started;
static uint32_t boot_id, sequence;
static bool healthy = true;
static char acknowledgement[65];

static int64_t now_ms(void) { return esp_timer_get_time()/1000; }

static void amp(bool enabled) {
    // TCA9555 EXIO8 is the amplifier enable. Other bank-1 pins remain inputs.
    uint8_t data[] = {3, enabled ? 1 : 0};
    ESP_ERROR_CHECK(i2c_master_transmit(expander, data, sizeof(data), 100));
}

static void init_hardware(void) {
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t bc = {.i2c_port=0, .sda_io_num=11, .scl_io_num=10,
        .clk_source=I2C_CLK_SRC_DEFAULT, .flags.enable_internal_pullup=true};
    ESP_ERROR_CHECK(i2c_new_master_bus(&bc, &bus));
    i2c_device_config_t ec = {.dev_addr_length=I2C_ADDR_BIT_LEN_7, .device_address=0x20, .scl_speed_hz=100000};
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &ec, &expander));
    amp(false);
    uint8_t direction[] = {7, 0xfe};
    ESP_ERROR_CHECK(i2c_master_transmit(expander, direction, sizeof(direction), 100));

    i2s_chan_handle_t tx;
    i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    ESP_ERROR_CHECK(i2s_new_channel(&cc, &tx, NULL));
    i2s_std_config_t sc = {
        .clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000),
        .slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg={.mclk=12, .bclk=13, .ws=14, .dout=16, .din=I2S_GPIO_UNUSED}
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx, &sc));
    ESP_ERROR_CHECK(i2s_channel_enable(tx));
    audio_codec_i2s_cfg_t dc = {.port=I2S_NUM_0, .tx_handle=tx};
    const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&dc);
    audio_codec_i2c_cfg_t ic = {.addr=ES8311_CODEC_DEFAULT_ADDR, .bus_handle=bus};
    const audio_codec_ctrl_if_t *ctrl = audio_codec_new_i2c_ctrl(&ic);
    es8311_codec_cfg_t es = {.codec_mode=ESP_CODEC_DEV_WORK_MODE_DAC, .ctrl_if=ctrl,
        .gpio_if=audio_codec_new_gpio(), .pa_pin=-1, .use_mclk=true};
    esp_codec_dev_cfg_t dev = {.codec_if=es8311_codec_new(&es), .data_if=data, .dev_type=ESP_CODEC_DEV_TYPE_OUT};
    codec = esp_codec_dev_new(&dev);
    assert(codec);
    esp_codec_dev_sample_info_t fs = {.sample_rate=16000, .channel=2, .bits_per_sample=32};
    ESP_ERROR_CHECK(esp_codec_dev_open(codec, &fs));
    ESP_ERROR_CHECK(esp_codec_dev_set_out_vol(codec, state.volume));
    // The board uses RGB wire order (the manufacturer's comment says GRB,
    // but its actual color_component_format is RGB).
    led_strip_config_t lc = {.strip_gpio_num=38, .max_leds=7, .color_component_format=LED_STRIP_COLOR_COMPONENT_FMT_RGB, .led_model=LED_MODEL_WS2812};
    led_strip_rmt_config_t rc = {.clk_src=RMT_CLK_SRC_DEFAULT, .resolution_hz=10000000, .flags.with_dma=false};
    ESP_ERROR_CHECK(led_strip_new_rmt_device(&lc, &rc, &leds));
    ESP_ERROR_CHECK(led_strip_clear(leds));
    gpio_config_t button = {.pin_bit_mask=1ULL<<0, .mode=GPIO_MODE_INPUT, .pull_up_en=true};
    ESP_ERROR_CHECK(gpio_config(&button));
}

static bool number(cJSON *v, int min, int max) {
    return cJSON_IsNumber(v) && v->valuedouble == v->valueint && v->valueint >= min && v->valueint <= max;
}

static bool apply(cJSON *changes) {
    if (!cJSON_IsObject(changes) || !changes->child || !healthy) return false;
    state_t next = state;
    cJSON *v;
    cJSON_ArrayForEach(v, changes) {
        const char *key=v->string;
        if (!strcmp(key,"power") && cJSON_IsBool(v)) next.power=cJSON_IsTrue(v);
        else if (!strcmp(key,"alarm_active") && cJSON_IsBool(v)) next.alarm_active=cJSON_IsTrue(v);
        else if (!strcmp(key,"brightness") && number(v,0,100)) next.brightness=v->valueint;
        else if (!strcmp(key,"volume") && number(v,0,100)) next.volume=v->valueint;
        else if (!strcmp(key,"alarm_duration") && number(v,1,60)) next.alarm_duration=v->valueint;
        else if (!strcmp(key,"mode") && cJSON_IsString(v) && (!strcmp(v->valuestring,"solid") || !strcmp(v->valuestring,"blink") || !strcmp(v->valuestring,"strobe"))) strcpy(next.mode,v->valuestring);
        else if (!strcmp(key,"alarm_mode") && cJSON_IsString(v) && (!strcmp(v->valuestring,"beep") || !strcmp(v->valuestring,"siren") || !strcmp(v->valuestring,"steady"))) strcpy(next.alarm_mode,v->valuestring);
        else if (!strcmp(key,"color") && cJSON_IsString(v) && strlen(v->valuestring)==7 && v->valuestring[0]=='#') {
            for (int i=1;i<7;i++) if (!isxdigit((unsigned char)v->valuestring[i])) return false;
            for (int i=0;i<7;i++) next.color[i]=toupper((unsigned char)v->valuestring[i]);
            next.color[7]=0;
        } else return false;
    }
    if (esp_codec_dev_set_out_vol(codec,next.volume)!=ESP_OK) return false;
    // An already-active command does not extend the alarm deadline.
    if (next.alarm_active && !state.alarm_active) {
        alarm_started=now_ms(); alarm_until=alarm_started+next.alarm_duration*1000;
    }
    state=next;
    return true;
}

static void report(void) {
    cJSON *root=cJSON_CreateObject(), *values=cJSON_AddObjectToObject(root,"values");
    cJSON_AddStringToObject(root,"protocol","waveshare-audio.v1");
    cJSON_AddNumberToObject(root,"boot_id",boot_id);
    cJSON_AddNumberToObject(root,"seq",sequence++);
    cJSON_AddBoolToObject(root,"hardware_ok",healthy);
    cJSON_AddBoolToObject(values,"power",state.power);
    cJSON_AddStringToObject(values,"color",state.color);
    cJSON_AddStringToObject(values,"mode",state.mode);
    cJSON_AddNumberToObject(values,"brightness",state.brightness);
    cJSON_AddBoolToObject(values,"alarm_active",state.alarm_active);
    cJSON_AddStringToObject(values,"alarm_mode",state.alarm_mode);
    cJSON_AddNumberToObject(values,"volume",state.volume);
    cJSON_AddNumberToObject(values,"alarm_duration",state.alarm_duration);
    if (acknowledgement[0]) cJSON_AddStringToObject(root,"ack",acknowledgement);
    char *line=cJSON_PrintUnformatted(root);
    usb_serial_jtag_write_bytes(line,strlen(line),pdMS_TO_TICKS(30));
    usb_serial_jtag_write_bytes("\n",1,pdMS_TO_TICKS(30));
    free(line); cJSON_Delete(root); acknowledgement[0]=0;
}

void app_main(void) {
    usb_serial_jtag_driver_config_t uc={.tx_buffer_size=2048,.rx_buffer_size=2048};
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&uc));
    init_hardware(); boot_id=esp_random(); last_ping=now_ms();
    char line[512]; size_t used=0; bool overflow=false;
    int64_t last_report=0; double phase=0; bool amp_on=false;
    while (true) {
        char bytes[128]; int count=usb_serial_jtag_read_bytes(bytes,sizeof(bytes),0);
        bool changed=false;
        for (int i=0;i<count;i++) {
            if (bytes[i]=='\n') {
                line[used]=0;
                cJSON *root=overflow?NULL:cJSON_Parse(line);
                if (root) {
                    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"ping"))) last_ping=now_ms();
                    cJSON *id=cJSON_GetObjectItemCaseSensitive(root,"id");
                    if (cJSON_IsString(id) && strlen(id->valuestring)<sizeof(acknowledgement) && apply(cJSON_GetObjectItemCaseSensitive(root,"set"))) {
                        strcpy(acknowledgement,id->valuestring); changed=true;
                    }
                    cJSON_Delete(root);
                }
                used=0; overflow=false;
            } else if (used<sizeof(line)-1) line[used++]=bytes[i];
            else overflow=true;
        }
        int64_t now=now_ms();
        if (now-last_ping>5000 || !gpio_get_level(0) || !healthy) {
            changed |= state.power || state.alarm_active;
            state.power=false; state.alarm_active=false;
        }
        if (state.alarm_active && now>=alarm_until) { state.alarm_active=false; changed=true; }
        bool lit=state.power && (!strcmp(state.mode,"solid") || (!strcmp(state.mode,"blink")?now%1000<500:now%1000<100));
        unsigned rgb=(unsigned)strtoul(state.color+1,NULL,16);
        for (int i=0;i<7;i++) {
            esp_err_t e=led_strip_set_pixel(leds,i,lit?((rgb>>16)&255)*state.brightness/100:0,lit?((rgb>>8)&255)*state.brightness/100:0,lit?(rgb&255)*state.brightness/100:0);
            healthy &= e==ESP_OK;
        }
        healthy &= led_strip_refresh(leds)==ESP_OK;
        if (amp_on!=state.alarm_active) { amp(state.alarm_active); amp_on=state.alarm_active; }
        int32_t pcm[320];
        double hz=!strcmp(state.alarm_mode,"siren")?700+500*(0.5+0.5*sin((now-alarm_started)*0.006283185)):880;
        bool sound=state.alarm_active && (strcmp(state.alarm_mode,"beep") || (now-alarm_started)%800<250);
        for (int i=0;i<160;i++) {
            int32_t sample=sound?(int32_t)(sin(phase)*268435456.0):0;
            phase+=6.28318530718*hz/16000; if(phase>6.28318530718)phase-=6.28318530718;
            pcm[2*i]=pcm[2*i+1]=sample;
        }
        healthy &= esp_codec_dev_write(codec,pcm,sizeof(pcm))==ESP_OK;
        if (changed || now-last_report>=1000) { report(); last_report=now; }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
