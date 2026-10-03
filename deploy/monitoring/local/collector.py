"""Bounded, project-scoped Docker metrics. No write operations or env export."""
import http.client
import html
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode
from pathlib import Path

PROJECT = os.environ['COMPOSE_PROJECT']
EXPECTED = os.environ['EXPECTED_SERVICES'].split(',')


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=3)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def read(path):
    connection = Docker()
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError('Docker read failed')
        return json.load(response)
    finally:
        connection.close()


def metrics():
    output = []
    try:
        query = urlencode({'all': 'true', 'filters': json.dumps({'label': ['com.docker.compose.project='+PROJECT]})})
        containers = read('/containers/json?'+query)
        by_service = {c['Labels'].get('com.docker.compose.service'): c for c in containers
                      if c['Labels'].get('com.docker.compose.oneoff', '').lower() != 'true'}
        for service in EXPECTED:
            container = by_service.get(service)
            info = read('/containers/'+container['Id']+'/json') if container else {}
            state = info.get('State', {})
            labels = '{service='+json.dumps(service)+'}'
            for key, value in {
                'running': int(state.get('Running', False)),
                'oom': int(state.get('OOMKilled', False)),
                'restarts_total': info.get('RestartCount', 0),
            }.items():
                output.append('iot_container_'+key+labels+' '+str(value))
        output.append('iot_container_collector_up 1')
    except (OSError, ValueError, RuntimeError, http.client.HTTPException):
        # Do not publish a partially healthy inventory when inspection fails.
        output = ['iot_container_collector_up 0']
    return '\n'.join(output)+'\n'


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/runbook':
            body = ('<!doctype html><title>Local monitoring runbook</title><meta name="viewport" content="width=device-width"><pre style="white-space:pre-wrap;max-width:90ch;margin:3rem auto;font:16px/1.6 system-ui">'+html.escape(Path('/app/runbook.md').read_text())+'</pre>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != '/metrics':
            self.send_error(404)
            return
        body = metrics().encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; version=0.0.4')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    def canary():
        while True:
            print(json.dumps({'level': 'info', 'message': 'monitoring_canary', 'time': time.time()}), flush=True)
            time.sleep(30)
    threading.Thread(target=canary, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 9101), Handler).serve_forever()
