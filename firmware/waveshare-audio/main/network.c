#include "network.h"
#ifdef WAVE_NETWORK_ENABLED
#include "wave_credentials.h"
#include "sparkplug_wire.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/time.h>
#include <time.h>
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#define LOG_LOCAL_LEVEL ESP_LOG_INFO
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_sntp.h"
#include "esp_wifi.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define CONNECTED 1
#define HOST_ONLINE 2
#define BORN 4
#define WIFI_READY 8
#define READY (CONNECTED | HOST_ONLINE | BORN)
static const char *TAG="waveshare-wifi";
static const char *keys[]={"power","color","mode","brightness","alarm_active","alarm_mode","volume","alarm_duration"};
static const char *names[]={"Power","Color","Mode","Brightness","Alarm active","Alarm mode","Volume","Alarm duration"};
static const uint8_t types[]={11,12,12,3,11,12,3,3};
typedef struct { char json[512]; } report_t;
typedef struct { bool node; size_t length; uint8_t bytes[2048]; } incoming_t;
static QueueHandle_t reports, incoming, commands;
static EventGroupHandle_t flags;
static esp_mqtt_client_handle_t client;
static esp_mqtt_client_config_t mqtt_config;
static char node_command[256], device_command[256], device_subscription[256], host_state[256];
static uint8_t bd_seq, sequence, death_bytes[256];
static uint64_t last_command_timestamp;
static int disconnect_reason;
static bool clock_ready;
static unsigned wifi_failures;
static incoming_t rx_frame;
static size_t rx_used, rx_total;
static int rx_kind;
static bool rx_retained;
static uint64_t wall_ms(void);
#ifndef WAVE_BDSEQ_INITIAL
#define WAVE_BDSEQ_INITIAL 0
#endif

static void connection_sequence(void) {
    nvs_handle_t nvs; ESP_ERROR_CHECK(nvs_open("waveshare",NVS_READWRITE,&nvs));
    bd_seq++; ESP_ERROR_CHECK(nvs_set_u8(nvs,"bdSeq",bd_seq));
    ESP_ERROR_CHECK(nvs_commit(nvs)); nvs_close(nvs);
    wave_sp_payload_t death={.timestamp=wall_ms(),.has_timestamp=true,.count=1};
    strcpy(death.metrics[0].name,"bdSeq"); death.metrics[0].datatype=4;
    death.metrics[0].value=bd_seq; death.metrics[0].has_value=true;
    mqtt_config.session.last_will.msg_len=wave_sp_encode(&death,death_bytes,sizeof(death_bytes));
    ESP_ERROR_CHECK(esp_mqtt_set_config(client,&mqtt_config));
}

static uint64_t wall_ms(void) { struct timeval tv; gettimeofday(&tv,NULL); return (uint64_t)tv.tv_sec*1000+tv.tv_usec/1000; }
static void forget_connection(void) {
    xEventGroupClearBits(flags,CONNECTED | HOST_ONLINE | BORN);
    xQueueReset(incoming); xQueueReset(commands); last_command_timestamp=0;
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t event, void *data) {
    if (base==WIFI_EVENT && event==WIFI_EVENT_STA_START) {
        if (esp_wifi_scan_start(NULL,false)!=ESP_OK) esp_wifi_connect();
    }
    if (base==WIFI_EVENT && event==WIFI_EVENT_SCAN_DONE) {
        uint16_t total=0; esp_wifi_scan_get_ap_num(&total);
        ESP_LOGI(TAG,"2.4 GHz scan found %u nearby networks",total);
        uint16_t count=32; wifi_ap_record_t *aps=calloc(count,sizeof(*aps));
        if (aps && esp_wifi_scan_get_ap_records(&count,aps)==ESP_OK) {
            size_t prefix=strcspn(WAVE_WIFI_SSID," '");
            for (uint16_t i=0;i<count;i++) {
                // Only log names matching the requested owner's name prefix.
                if (prefix>=3 && !strncasecmp((char *)aps[i].ssid,WAVE_WIFI_SSID,prefix))
                    ESP_LOGI(TAG,"Matching hotspot advertised as '%s' (channel %u)",aps[i].ssid,aps[i].primary);
            }
        }
        free(aps); esp_wifi_connect();
    }
    if (base==WIFI_EVENT && event==WIFI_EVENT_STA_DISCONNECTED) {
        disconnect_reason=((wifi_event_sta_disconnected_t *)data)->reason;
        ESP_LOGI(TAG,"Hotspot disconnected; Wi-Fi reason %d",disconnect_reason);
        xEventGroupClearBits(flags,WIFI_READY); forget_connection();
        if (disconnect_reason==WIFI_REASON_NO_AP_FOUND && (++wifi_failures % 3)==0) {
            if (esp_wifi_scan_start(NULL,false)!=ESP_OK) esp_wifi_connect();
        } else esp_wifi_connect();
    }
    if (base==IP_EVENT && event==IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ip=data;
        ESP_LOGI(TAG,"Hotspot connected; IP " IPSTR,IP2STR(&ip->ip_info.ip));
        disconnect_reason=0;
        wifi_failures=0;
        xEventGroupSetBits(flags,WIFI_READY);
    }
}
static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_mqtt_event_handle_t e=data;
    if (id==MQTT_EVENT_BEFORE_CONNECT) {
        connection_sequence();
    } else if (id==MQTT_EVENT_CONNECTED) {
        forget_connection(); xEventGroupSetBits(flags,CONNECTED);
        esp_mqtt_client_subscribe(client,node_command,0);
        // Existing scoped broker ACL permits this literal subscription. Incoming
        // messages are still matched to this board's exact rgb-light topic.
        esp_mqtt_client_subscribe(client,device_subscription,0);
        esp_mqtt_client_subscribe(client,host_state,1);
        ESP_LOGI(TAG,"Staging MQTT connected with verified TLS");
    } else if (id==MQTT_EVENT_DISCONNECTED) {
        rx_used=rx_total=0; rx_kind=0;
        forget_connection();
    } else if (id==MQTT_EVENT_SUBSCRIBED) {
        ESP_LOGI(TAG,"MQTT subscription acknowledged (%d)",e->msg_id);
    } else if (id==MQTT_EVENT_DATA) {
        // Mobile networks can fragment even small frames. Reassemble exactly one
        // bounded payload, requiring contiguous offsets and consistent lengths.
        if (e->total_data_len<1 || e->total_data_len>(int)sizeof(rx_frame.bytes) || e->data_len<0
            || e->current_data_offset<0 || e->current_data_offset>e->total_data_len-e->data_len) {
            rx_used=rx_total=0; return;
        }
        if (!e->current_data_offset) {
            rx_used=0; rx_total=e->total_data_len; rx_kind=0; rx_retained=e->retain;
            if (e->topic && e->topic_len==(int)strlen(host_state) && !memcmp(e->topic,host_state,e->topic_len)) rx_kind=1;
            if (e->topic && e->topic_len==(int)strlen(node_command) && !memcmp(e->topic,node_command,e->topic_len)) rx_kind=2;
            if (e->topic && e->topic_len==(int)strlen(device_command) && !memcmp(e->topic,device_command,e->topic_len)) rx_kind=3;
        }
        if (!rx_kind || rx_total!=(size_t)e->total_data_len || rx_used!=(size_t)e->current_data_offset) { rx_used=rx_total=0; return; }
        memcpy(rx_frame.bytes+rx_used,e->data,e->data_len); rx_used+=e->data_len;
        if (rx_used<rx_total) return;
        rx_frame.length=rx_total; rx_used=rx_total=0;
        if (rx_kind==1) {
            cJSON *state=cJSON_ParseWithLength((char *)rx_frame.bytes,rx_frame.length);
            if (state && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(state,"online"))) {
                xEventGroupSetBits(flags,HOST_ONLINE); xEventGroupClearBits(flags,BORN);
            } else {
                xEventGroupClearBits(flags,HOST_ONLINE | BORN); xQueueReset(commands); xQueueReset(incoming);
            }
            cJSON_Delete(state); return;
        }
        ESP_LOGI(TAG,"Hardware control received: %u bytes, retained=%d, ready=%d",(unsigned)rx_frame.length,rx_retained,wave_network_ready());
        if (rx_retained || !wave_network_ready()) return;
        rx_frame.node=rx_kind==2; xQueueSend(incoming,&rx_frame,0);
    }
}
static bool publish(const char *kind, wave_sp_payload_t *payload, bool device) {
    uint8_t bytes[2048]; char topic[256];
    snprintf(topic,sizeof(topic),"spBv1.0/%s/%s/%s%s",WAVE_SP_GROUP,kind,WAVE_SP_NODE,device?"/rgb-light":"");
    payload->timestamp=wall_ms(); payload->has_timestamp=true;
    payload->seq=sequence; payload->has_seq=true;
    size_t size=wave_sp_encode(payload,bytes,sizeof(bytes));
    if (!size || esp_mqtt_client_publish(client,topic,(char *)bytes,size,0,false)<0) return false;
    sequence=(sequence+1)%256; return true;
}
static bool hardware_payload(const char *json, wave_sp_payload_t *payload) {
    cJSON *root=cJSON_Parse(json), *values=cJSON_GetObjectItemCaseSensitive(root,"values");
    bool okay=root && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"hardware_ok")) && cJSON_IsObject(values);
    memset(payload,0,sizeof(*payload)); payload->count=8;
    for (int i=0; i<8 && okay; i++) {
        cJSON *v=cJSON_GetObjectItemCaseSensitive(values,keys[i]); wave_sp_metric_t *m=&payload->metrics[i];
        snprintf(m->name,sizeof(m->name),"%s",names[i]); m->alias=i+1; m->has_alias=m->has_value=true; m->datatype=types[i];
        if (types[i]==11) { okay=cJSON_IsBool(v); m->value=cJSON_IsTrue(v); }
        else if (types[i]==3) { okay=cJSON_IsNumber(v) && v->valueint>=0; if(okay)m->value=v->valueint; }
        else { okay=cJSON_IsString(v) && strlen(v->valuestring)<sizeof(m->string_value); if(okay)strcpy(m->string_value,v->valuestring); }
    }
    cJSON_Delete(root); return okay;
}
static void command(const incoming_t *message) {
    wave_sp_payload_t p;
    if (!wave_network_ready()) return;
    if (!wave_sp_decode(message->bytes,message->length,&p) || !p.count) {
        ESP_LOGW(TAG,"Rejected malformed Sparkplug command"); return;
    }
    if (message->node) {
        for (size_t i=0;i<p.count;i++) if (!strcmp(p.metrics[i].name,"Node Control/Rebirth") && p.metrics[i].datatype==11 && p.metrics[i].value) xEventGroupClearBits(flags,BORN);
        return;
    }
    uint64_t now=wall_ms();
    if (!p.has_timestamp || p.timestamp+15000<now || p.timestamp>now+2000 || p.timestamp<=last_command_timestamp) {
        ESP_LOGW(TAG,"Rejected stale/repeated command (clock delta %lld ms)",(long long)(now-p.timestamp)); return;
    }
    cJSON *root=cJSON_CreateObject(), *changes=cJSON_AddObjectToObject(root,"set");
    bool okay=true; unsigned seen=0;
    for (size_t i=0;i<p.count && okay;i++) {
        wave_sp_metric_t *m=&p.metrics[i]; int index=-1;
        for (int j=0;j<8;j++) if ((m->name[0] && !strcmp(m->name,names[j])) || (!m->name[0] && m->has_alias && m->alias==(uint64_t)j+1)) index=j;
        if (index<0 || (seen & (1u<<index)) || m->datatype!=types[index]) { okay=false; break; }
        seen |= 1u<<index;
        if (m->datatype==11)cJSON_AddBoolToObject(changes,keys[index],m->value);
        else if (m->datatype==12)cJSON_AddStringToObject(changes,keys[index],m->string_value);
        else cJSON_AddNumberToObject(changes,keys[index],m->value);
    }
    char id[65]; snprintf(id,sizeof(id),"mqtt-%llu",(unsigned long long)p.timestamp);
    cJSON_AddStringToObject(root,"id",p.uuid[0]?p.uuid:id);
    report_t frame;
    if (okay && cJSON_PrintPreallocated(root,frame.json,sizeof(frame.json),false) && xQueueSend(commands,&frame,0)==pdTRUE) {
        last_command_timestamp=p.timestamp; ESP_LOGI(TAG,"Validated hardware control queued");
    } else ESP_LOGW(TAG,"Rejected unknown/duplicate metric or full command queue");
    cJSON_Delete(root);
}
static void network_task(void *arg) {
    xEventGroupWaitBits(flags,WIFI_READY,false,true,portMAX_DELAY);
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0,"pool.ntp.org"); esp_sntp_setservername(1,"time.cloudflare.com"); esp_sntp_init();
    while (time(NULL)<1735689600) vTaskDelay(pdMS_TO_TICKS(500));
    clock_ready=true;
    ESP_LOGI(TAG,"Clock synchronized for TLS certificate validation");
    wave_sp_payload_t death={.timestamp=wall_ms(),.has_timestamp=true,.count=1};
    strcpy(death.metrics[0].name,"bdSeq"); death.metrics[0].datatype=4; death.metrics[0].value=bd_seq; death.metrics[0].has_value=true;
    size_t death_size=wave_sp_encode(&death,death_bytes,sizeof(death_bytes));
    static char death_topic[256]; snprintf(death_topic,sizeof(death_topic),"spBv1.0/%s/NDEATH/%s",WAVE_SP_GROUP,WAVE_SP_NODE);
    mqtt_config=(esp_mqtt_client_config_t){
        .broker.address.uri=WAVE_MQTT_URI,.broker.verification.crt_bundle_attach=esp_crt_bundle_attach,
        .credentials.username=WAVE_MQTT_USERNAME,.credentials.client_id=WAVE_MQTT_USERNAME,
        .credentials.authentication.password=WAVE_MQTT_PASSWORD,
        .session.keepalive=10,.session.disable_clean_session=false,
        .session.last_will={.topic=death_topic,.msg=(char *)death_bytes,.msg_len=death_size,.qos=1,.retain=false},
        .buffer.size=4096,.buffer.out_size=4096,.task.stack_size=8192,
        .network.reconnect_timeout_ms=2000,.network.timeout_ms=3000,
    };
    client=esp_mqtt_client_init(&mqtt_config); ESP_ERROR_CHECK(esp_mqtt_client_register_event(client,ESP_EVENT_ANY_ID,mqtt_event,NULL));
    ESP_ERROR_CHECK(esp_mqtt_client_start(client));
    report_t report; incoming_t message;
    while (true) {
        while (xQueueReceive(incoming,&message,0)==pdTRUE) command(&message);
        if (xQueueReceive(reports,&report,pdMS_TO_TICKS(100))!=pdTRUE) continue;
        EventBits_t current=xEventGroupGetBits(flags);
        if ((current & (CONNECTED | HOST_ONLINE))!=(CONNECTED | HOST_ONLINE)) continue;
        wave_sp_payload_t hardware;
        if (!hardware_payload(report.json,&hardware)) { xEventGroupClearBits(flags,BORN); continue; }
        if (!(current & BORN)) {
            sequence=0; wave_sp_payload_t node={.count=2};
            strcpy(node.metrics[0].name,"bdSeq"); node.metrics[0].datatype=4; node.metrics[0].value=bd_seq; node.metrics[0].has_value=true;
            strcpy(node.metrics[1].name,"Node Control/Rebirth"); node.metrics[1].datatype=11; node.metrics[1].has_value=true;
            if (publish("NBIRTH",&node,false) && publish("DBIRTH",&hardware,true)) {
                xEventGroupSetBits(flags,BORN); ESP_LOGI(TAG,"Physical board online: eight hardware metrics");
            }
        } else if (!publish("DDATA",&hardware,true)) xEventGroupClearBits(flags,BORN);
    }
}
void wave_network_start(void) {
    esp_err_t result=nvs_flash_init();
    if (result==ESP_ERR_NVS_NO_FREE_PAGES || result==ESP_ERR_NVS_NEW_VERSION_FOUND) { ESP_ERROR_CHECK(nvs_flash_erase()); result=nvs_flash_init(); }
    ESP_ERROR_CHECK(result);
    nvs_handle_t nvs; ESP_ERROR_CHECK(nvs_open("waveshare",NVS_READWRITE,&nvs));
    bd_seq=WAVE_BDSEQ_INITIAL;
    nvs_get_u8(nvs,"bdSeq",&bd_seq); nvs_close(nvs);
    flags=xEventGroupCreate(); reports=xQueueCreate(1,sizeof(report_t)); incoming=xQueueCreate(4,sizeof(incoming_t)); commands=xQueueCreate(4,sizeof(report_t));
    assert(flags && reports && incoming && commands);
    snprintf(node_command,sizeof(node_command),"spBv1.0/%s/NCMD/%s",WAVE_SP_GROUP,WAVE_SP_NODE);
    snprintf(device_command,sizeof(device_command),"spBv1.0/%s/DCMD/%s/rgb-light",WAVE_SP_GROUP,WAVE_SP_NODE);
    snprintf(device_subscription,sizeof(device_subscription),"spBv1.0/%s/DCMD/%s/+",WAVE_SP_GROUP,WAVE_SP_NODE);
    snprintf(host_state,sizeof(host_state),"spBv1.0/STATE/%s",WAVE_SP_HOST);
    ESP_ERROR_CHECK(esp_netif_init()); ESP_ERROR_CHECK(esp_event_loop_create_default()); esp_netif_create_default_wifi_sta();
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT(); ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    wifi_config_t wifi={0};
    _Static_assert(sizeof(WAVE_WIFI_SSID)-1<=32,"SSID too long");
    _Static_assert(sizeof(WAVE_WIFI_PASSWORD)-1<=63,"Wi-Fi password too long");
    memcpy(wifi.sta.ssid,WAVE_WIFI_SSID,sizeof(WAVE_WIFI_SSID)-1); memcpy(wifi.sta.password,WAVE_WIFI_PASSWORD,sizeof(WAVE_WIFI_PASSWORD)-1);
    wifi.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK; wifi.sta.pmf_cfg.capable=true;
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM)); ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&wifi));
    esp_log_level_set(TAG,ESP_LOG_INFO);
    ESP_ERROR_CHECK(esp_wifi_start()); ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    assert(xTaskCreate(network_task,"wave-network",14336,NULL,5,NULL)==pdPASS);
}
bool wave_network_ready(void) { return flags && (xEventGroupGetBits(flags) & READY)==READY; }
const char *wave_network_state(void) {
    EventBits_t bits=flags?xEventGroupGetBits(flags):0;
    if (!(bits & WIFI_READY)) return "wifi_connecting";
    if (!clock_ready) return "clock_sync";
    if (!(bits & CONNECTED)) return "mqtt_connecting";
    if (!(bits & HOST_ONLINE)) return "waiting_for_host";
    return (bits & BORN)?"online":"birth_pending";
}
int wave_network_disconnect_reason(void) { return disconnect_reason; }
void wave_network_report(const char *json) {
    if (!reports || strlen(json)>=sizeof(((report_t *)0)->json)) return;
    report_t report; strcpy(report.json,json); xQueueOverwrite(reports,&report);
}
bool wave_network_command(char *json, size_t capacity) {
    report_t frame;
    if (!wave_network_ready() || xQueueReceive(commands,&frame,0)!=pdTRUE) return false;
    if (strlen(frame.json)>=capacity) return false;
    strcpy(json,frame.json); return true;
}
#else
void wave_network_start(void) {}
bool wave_network_ready(void) { return false; }
void wave_network_report(const char *json) {}
bool wave_network_command(char *json, size_t capacity) { return false; }
const char *wave_network_state(void) { return "usb_only"; }
int wave_network_disconnect_reason(void) { return 0; }
#endif
