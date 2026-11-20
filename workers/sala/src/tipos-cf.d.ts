/** Los tipos de Cloudflare Workers que usa el servicio de la sala (Durable Objects y runtime). Sin el paquete
 * `@cloudflare/workers-types` instalado, este es el mínimo que el typecheck necesita; si algún día entra
 * el paquete, este archivo se reemplaza por `"types": ["@cloudflare/workers-types"]` en el tsconfig. */
declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown, State = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(state: DurableObjectState, env: Env);
    fetch(request: Request): Promise<Response>;
    alarm(): Promise<void>;
    webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void;
    webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void;
    webSocketError(ws: WebSocket, error: unknown): void;
  }
}

/** El contexto del evento que Cloudflare pasa al export default del servicio (`fetch(req, env, ctx)`). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props<T>(): T;
}
interface ExportedHandler<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void }): Response | Promise<Response>;
}
interface DurableObjectNamespace<BindT = unknown> {
  newId(name: string): string;
  idFromName(name: string): string;
  idFromString(name: string): string;
  get<T extends DurableObjectBranded = DurableObjectBranded>(idOrName: string): DurableObjectStub<T>;
}
interface DurableObjectBranded {
  readonly __doBrand: unique symbol;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  idFromString(name: string): string;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
  getWebSocketAutoResponse(): WebSocketRequestResponsePair | null;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
  getWebSockets(tag: string): WebSocket[];
}
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T>(options?: { start?: string; end?: string; limit?: number }): Promise<Map<string, T>>;
  deleteAll(options?: unknown): Promise<unknown>;
  delete(options: unknown): Promise<unknown>;
  setAlarm(time: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
  sql: {
    exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): {
      rows: Array<T>;
      rowsWritten: number;
      toArray(): Array<T>;
      one(): T;
      raw(): Array<unknown[]>;
    };
  };
  sync(): Promise<void>;
  serializationGainHint(): number;
  setWsAutoResponse?(): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment<T = unknown>(): T;
  setWebSocketAutoResponsePair?(pair: WebSocketRequestResponsePair): void;
}
declare const WebSocketRequestResponsePair: { new(requestTag: string, responseTag: string): WebSocketRequestResponsePairRec };
interface WebSocketRequestResponsePairRec {
  request: { url: string; headers: Record<string, string> } | null;
  response: { status: number; webSocket: unknown } | null;
}
declare const WebSocketPair: { new(): { 0: WebSocket; 1: WebSocket } };
interface WebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment<T = unknown>(): T;
}

// El 101 de un socket de Durable Object lleva `webSocket` en el init de la respuesta.
interface ResponseInit {
  webSocket?: WebSocket;
}
