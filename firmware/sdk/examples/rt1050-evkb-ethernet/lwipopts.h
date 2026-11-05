/* SPDX-License-Identifier: MIT */
/*
 * lwIP for one TLS connection to the broker, DHCP, DNS and SNTP, on FreeRTOS with the
 * MCUXpresso ENET driver. Sizes follow the MCUXpresso lwIP examples for this board;
 * lwIP's own defaults (lwip/opt.h) cover everything not set here.
 */
#ifndef LWIPOPTS_H
#define LWIPOPTS_H

/* The IoT OS clock port takes the time from SNTP (sdk/ports/mcuxpresso-lwip). */
void iotos_mcux_sntp_set(unsigned long sec, unsigned long us);
#define SNTP_SET_SYSTEM_TIME_US(sec, us) iotos_mcux_sntp_set((sec), (us))
#define SNTP_SERVER_DNS 1
#define SNTP_STARTUP_DELAY 0
#define SNTP_UPDATE_DELAY (60 * 60 * 1000) /* an hour */

/* FreeRTOS, with the core lock the MCUXpresso port provides. */
void sys_lock_tcpip_core(void);
void sys_unlock_tcpip_core(void);
void sys_check_core_locking(void);
void sys_mark_tcpip_thread(void);
#define NO_SYS 0
#define SYS_LIGHTWEIGHT_PROT 1
#define LWIP_TCPIP_CORE_LOCKING 1
#define LOCK_TCPIP_CORE() sys_lock_tcpip_core()
#define UNLOCK_TCPIP_CORE() sys_unlock_tcpip_core()
#define LWIP_ASSERT_CORE_LOCKED() sys_check_core_locking()
#define LWIP_MARK_TCPIP_THREAD() sys_mark_tcpip_thread()
#define TCPIP_THREAD_STACKSIZE 1024
#define TCPIP_THREAD_PRIO 8
#define TCPIP_MBOX_SIZE 32
#define DEFAULT_THREAD_STACKSIZE 3000
#define DEFAULT_THREAD_PRIO 3
#define DEFAULT_RAW_RECVMBOX_SIZE 12
#define DEFAULT_UDP_RECVMBOX_SIZE 12
#define DEFAULT_TCP_RECVMBOX_SIZE 12
#define DEFAULT_ACCEPTMBOX_SIZE 12

/* APIs */
#define LWIP_NETCONN 1
#define LWIP_SOCKET 1
#define LWIP_COMPAT_SOCKETS 0 /* the ports call lwip_socket() and friends by name */
#define LWIP_SO_RCVTIMEO 1
#define LWIP_SO_SNDTIMEO 1
#define LWIP_NETIF_API 1
#define LWIP_NETIF_EXT_STATUS_CALLBACK 1
#define LWIP_NETIF_LINK_CALLBACK 1
#define LWIP_SINGLE_NETIF 1
#define LWIP_PROVIDE_ERRNO 1
#define LWIP_DEFINE_LWIP_RAND_IN_CC_H 1 /* LWIP_RAND from the MCUXpresso port */

/* Protocols */
#define LWIP_IPV4 1
#define LWIP_ICMP 1
#define LWIP_RAW 1
#define LWIP_DHCP 1
#define LWIP_DNS 1
#define LWIP_UDP 1
#define LWIP_TCP 1
#define LWIP_TCP_KEEPALIVE 1
#define TCP_TTL 255
#define UDP_TTL 255
#define TCP_QUEUE_OOSEQ 0
#define TCP_MSS (1500 - 40)
#define TCP_SND_BUF (6 * TCP_MSS)
#define TCP_SND_QUEUELEN ((3 * TCP_SND_BUF) / TCP_MSS)
#define TCP_WND (2 * TCP_MSS)

/* Memory */
#define MEM_ALIGNMENT 4
#define MEM_SIZE (22 * 1024)
#define MEMP_NUM_PBUF 15
#define MEMP_NUM_UDP_PCB 6
#define MEMP_NUM_TCP_PCB 10
#define MEMP_NUM_TCP_PCB_LISTEN 2
#define MEMP_NUM_TCP_SEG 22
#define MEMP_NUM_REASSDATA 2
#define MEMP_NUM_SYS_TIMEOUT (LWIP_NUM_SYS_TIMEOUT_INTERNAL + 2) /* and the SNTP timer */
#define MEMP_NUM_NETCONN 4
#define PBUF_POOL_SIZE 5
#define IP_REASS_MAX_PBUFS 4

/* The ENET port (enet_ethernetif.c): buffers, link polling and the receive task. */
#define ENET_RXBD_NUM 5
#define ENET_TXBD_NUM 3
#define ENET_RXBUFF_SIZE 1518
#define ENET_TXBUFF_SIZE 1514
#define ETH_LINK_POLLING_INTERVAL_MS 1500
#define ETH_DO_RX_IN_SEPARATE_TASK 1
#define ETH_RX_TASK_STACK_SIZE 512
#define ETH_RX_TASK_PRIO (configTIMER_TASK_PRIORITY - 1)
#define ETH_DISABLE_RX_INT_WHEN_OUT_OF_BUFFERS 1
#define ETH_USE_GPIO_ADAPTER 1

/* CHECKSUM_GEN_* and CHECKSUM_CHECK_* come from the ENET port's build settings. */
#define LWIP_STATS 0

#endif
