import type * as Party from "partykit/server";

export interface NoteState {
  content: string;
  lastEditedBy: string;
  lastEditedAt: number;
}

export interface User {
  id: string;
  name: string;
  color: string;
}

type ServerMessage =
  | { type: "update"; content: string; user: User }
  | { type: "join"; user: User }
  | { type: "leave"; userId: string }
  | { type: "sync"; note: NoteState; users: User[] };

const COLORS = [
  "#e63946", "#2a9d8f", "#e9c46a", "#f4a261",
  "#457b9d", "#8338ec", "#fb5607", "#3a86ff",
];

export default class LiveNotesServer implements Party.Server {
  note: NoteState = { content: "", lastEditedBy: "", lastEditedAt: 0 };
  users: Map<string, User> = new Map();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    // Persist note across restarts
    const saved = await this.room.storage.get<NoteState>("note");
    if (saved) this.note = saved;
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const name = url.searchParams.get("name") || "Anonymous";
    const color = COLORS[this.users.size % COLORS.length];

    const user: User = { id: conn.id, name, color };
    this.users.set(conn.id, user);

    // Send current state to the new joiner
    const syncMsg: ServerMessage = {
      type: "sync",
      note: this.note,
      users: [...this.users.values()],
    };
    conn.send(JSON.stringify(syncMsg));

    // Notify everyone else
    this.room.broadcast(
      JSON.stringify({ type: "join", user } satisfies ServerMessage),
      [conn.id]
    );
  }

  onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message) as { type: "update"; content: string };
    const user = this.users.get(sender.id);
    if (!user || data.type !== "update") return;

    this.note = {
      content: data.content,
      lastEditedBy: user.name,
      lastEditedAt: Date.now(),
    };

    // Persist to durable storage
    this.room.storage.put("note", this.note);

    // Broadcast to all OTHER clients
    this.room.broadcast(
      JSON.stringify({ type: "update", content: data.content, user } satisfies ServerMessage),
      [sender.id]
    );
  }

  onClose(conn: Party.Connection) {
    this.users.delete(conn.id);
    this.room.broadcast(
      JSON.stringify({ type: "leave", userId: conn.id } satisfies ServerMessage)
    );
  }
}

LiveNotesServer satisfies Party.Worker;

