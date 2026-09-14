#!/usr/bin/env python3
"""Paper MCP helper for building Spectre X marketing designs."""
import json, http.client, urllib.parse, sys

URL = urllib.parse.urlparse("http://127.0.0.1:29979/mcp")
HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
SESSION_ID = None

IMG_BASE = "http://localhost:29979/media/Users/sunny/Desktop/Spectre App Main/apps/research/public"

def call_tool(name, args={}):
    global SESSION_ID
    conn = http.client.HTTPConnection(URL.hostname, URL.port, timeout=60)
    extra = {"mcp-session-id": SESSION_ID} if SESSION_ID else {}
    h = {**HEADERS, **extra}

    if not SESSION_ID:
        conn.request("POST", URL.path, body=json.dumps({
            "jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{"protocolVersion":"2024-11-05","capabilities":{},
                      "clientInfo":{"name":"claude-code","version":"1.0"}}
        }), headers=h)
        resp = conn.getresponse()
        rh = dict(resp.getheaders())
        resp.read()
        SESSION_ID = rh.get("mcp-session-id","")
        extra = {"mcp-session-id": SESSION_ID}
        h = {**HEADERS, **extra}
        conn.request("POST", URL.path, body=json.dumps({
            "jsonrpc":"2.0","method":"notifications/initialized"
        }), headers=h)
        conn.getresponse().read()

    conn.request("POST", URL.path, body=json.dumps({
        "jsonrpc":"2.0","id":99,"method":"tools/call",
        "params":{"name":name,"arguments":args}
    }), headers=h)
    resp = conn.getresponse()
    body = resp.read().decode('utf-8')
    conn.close()

    for line in body.split('\n'):
        if line.startswith('data: '):
            data = json.loads(line[6:])
            if "result" in data:
                texts = []
                for c in data["result"].get("content",[]):
                    if c.get("type") == "text":
                        texts.append(c["text"])
                return "\n".join(texts)
            elif "error" in data:
                return f"ERROR: {json.dumps(data['error'])}"
    return body

def create_artboard(name, w, h, bg="#000000"):
    return call_tool("create_artboard", {
        "name": name,
        "styles": {
            "width": f"{w}px",
            "height": f"{h}px",
            "backgroundColor": bg,
            "display": "flex",
            "flexDirection": "column",
            "alignItems": "center",
            "justifyContent": "center",
            "overflow": "hidden",
            "position": "relative"
        }
    })

def write_html(target_id, html, mode="insert-children"):
    return call_tool("write_html", {
        "targetNodeId": target_id,
        "html": html,
        "mode": mode
    })

def get_id_from_result(result):
    """Extract node ID from tool result."""
    try:
        data = json.loads(result)
        if isinstance(data, dict):
            return data.get("id") or data.get("nodeId")
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("id") or data[0].get("nodeId")
    except:
        pass
    return None

if __name__ == "__main__":
    print("Paper MCP Helper loaded")
    print(f"Image base: {IMG_BASE}")
    result = call_tool("get_basic_info")
    print(result)
