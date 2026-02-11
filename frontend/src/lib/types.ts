export type MissionStatus = "draft" | "executing" | "paused" | "completed" | "deleted";

export type Mission = {
  id: string;
  title: string;
  goal: { x: number; y: number; [k: string]: any };
  status: MissionStatus;
  created_at: string;
  updated_at?: string | null;
};

export type WsMessage =
  | { kind: "telemetry"; data: any }
  | { kind: "event"; data: any }
  | { kind: "alert"; data: any }
  | { kind: "status"; data: any };
