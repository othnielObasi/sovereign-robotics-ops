export type Mission = {
  id: string;
  title: string;
  goal: { x: number; y: number; [k: string]: any };
  created_at: string;
};

export type WsMessage =
  | { kind: "telemetry"; data: any }
  | { kind: "event"; data: any }
  | { kind: "alert"; data: any }
  | { kind: "status"; data: any };
