import { join } from "node:path";
import { ModelOperations } from "@vscode/vscode-languagedetection";
import piston from "piston-client";

const acePath = join(__dirname, "ace-builds", "src-min");
const modulePath = join(__dirname, "node_modules");
const sauce = join(__dirname, "sauce");
const errorPage = await Bun.file(join(sauce, "404.html")).text();
const server = "http://2.dreamnity.in:2000/api/v2/connect";
const classifier = new ModelOperations();

console.log("\u001bcIt works", Date.now() % 10000);
Bun.serve<ExecutionData>({
  async fetch(req) {
    const url = new URL(req.url);
    // Modules
    if (url.pathname.startsWith("/module"))
      return new Response(Bun.file(join(modulePath, url.pathname.split("/").slice(2).join("/"))));
    // Ace-related files
    if (url.pathname.startsWith("/ace"))
      return new Response(Bun.file(join(acePath, url.pathname.split("/").slice(2).join("/"))));
    if (url.pathname.startsWith("/api/classify")) {
      const result = await classifier.runModel(await req.text());
      console.log(result[0])
      if (!result?.[0]) return new Response("null", {
        status: 404
      });
      return new Response(result[0].languageId);
    }
    if (url.pathname.startsWith("/api/execute")) {
      /*const result = await client.execute(, await req.text(), {
        version: '*'
      });*/
      if (!this.upgrade(req, {
        data: {
          lang: url.searchParams.get("lang") || 'js'
        }
      })) return new Response("Invalid request", {
        status: 400
      });
    }
    let path = join(sauce, url.pathname);
    if (path.endsWith("/") && await Bun.file(path + "index.html").exists())
      return new Response(Bun.file(path + "index.html"));
    const file = Bun.file(path);
    if (!await file.exists()) return makeErrorPage("Page not found", 404);
    return new Response(file);
  },
  error(req) {
    return makeErrorPage(req.message);
  },
  websocket: {
    open(ws) {
      ws.send("!!ready");
    },
    message(ws, msg) {
      const message = msg.toString();
      if (ws.data.code === undefined) {
        ws.data.code = message;

        const back = ws.data.conn = new WebSocket(server);
        back.onopen = () => {
          ws.send("!!starting");
          back.send(JSON.stringify({
            type: "init",
            language: ws.data.lang,
            version: "*",
            files: [{
              content: ws.data.code
            }],
            run_timeout: 600000,
            run_memory_limit: 5e+7
          }));
        };
        back.onmessage = msg => {
          const data = JSON.parse(msg.data.toString());
          switch (data?.type) {
            case 'stage':
              if (data?.stage == 'run') ws.send("!!running");
              break;
            case 'data':
              ws.send(data.data);
              break;
            case 'exit':
              ws.send("\x1b[34m[exit: " + (data.signal || data.code) + "]\x1b[0m");
              if(data.code) ws.send("!!exit "+(data.code||0));
              ws.close();
              back.close();
              break;
            case 'error':
              ws.send("\x1b[31m[error: " + data.message + "]\x1b[0m");
              ws.send("!!exit (internal error)");
              ws.close();
              back.close();
              break;
            default:
              return;
          }
        }
      }
      if (ws?.data?.conn?.readyState !== 1) return;
      ws.data.conn.send(JSON.stringify({
        type: "data",
        stream: "stdin",
        data: message
      }));
    },
    close(ws) {
      if (ws?.data?.conn?.readyState === 1) {
        ws.data.conn.send(JSON.stringify({
          type: "signal",
          signal: "SIGKILL"
        }));
        ws.data.conn.close();
      }
    }
  },
  port: 50004
});

function makeErrorPage(message: string, code: number = 500) {
  return new Response(errorPage.replace("{{ERROR}}", message), {
    status: code,
    statusText: message,
    headers: {
      'Content-Type': "text/html"
    }
  });
}

interface ExecutionData {
  lang: string,
  code: string,
  conn: WebSocket
};