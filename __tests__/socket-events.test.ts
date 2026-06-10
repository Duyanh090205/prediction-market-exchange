/**
 * Socket routing for chat (#8). The privacy-critical property: a DM must reach
 * ONLY the two participants' user rooms — never a global broadcast. Lobby
 * broadcasts to everyone; market goes to the contract room. Pure routing test
 * (no DB) — mocks the io instance via the global the module reads.
 */

import { emitMessageCreated } from "@/lib/socket-events";

type Call = { rooms: string[]; global: boolean; event: string };

function installMockIo() {
  const calls: Call[] = [];
  let cur: string[] = [];
  const chain = {
    to(room: string) {
      cur.push(room);
      return chain;
    },
    emit(event: string) {
      calls.push({ rooms: [...cur], global: false, event });
    },
  };
  const io = {
    to(room: string) {
      cur = [room];
      return chain;
    },
    emit(event: string) {
      calls.push({ rooms: [], global: true, event });
    },
  };
  (global as unknown as { __io?: unknown }).__io = io;
  return calls;
}

afterEach(() => {
  delete (global as unknown as { __io?: unknown }).__io;
});

const base = { id: 1, userId: 10, username: "a", body: "hi", createdAt: "t" };

test("DM emits ONLY to both participants' user rooms (never global)", () => {
  const calls = installMockIo();
  emitMessageCreated({ ...base, contractId: null, recipientId: 20 });
  expect(calls).toHaveLength(1);
  expect(calls[0].global).toBe(false);
  expect(calls[0].rooms.sort()).toEqual(["user:10", "user:20"]);
});

test("lobby message broadcasts globally", () => {
  const calls = installMockIo();
  emitMessageCreated({ ...base, contractId: null, recipientId: null });
  expect(calls).toHaveLength(1);
  expect(calls[0].global).toBe(true);
});

test("market message goes only to the contract room", () => {
  const calls = installMockIo();
  emitMessageCreated({ ...base, contractId: 7, recipientId: null });
  expect(calls).toHaveLength(1);
  expect(calls[0].global).toBe(false);
  expect(calls[0].rooms).toEqual(["contract:7"]);
});

test("no-op when io is not attached (e.g. next dev without server.js)", () => {
  // No mock installed → getIO() returns null → must not throw.
  expect(() => emitMessageCreated({ ...base, contractId: null, recipientId: 20 })).not.toThrow();
});
