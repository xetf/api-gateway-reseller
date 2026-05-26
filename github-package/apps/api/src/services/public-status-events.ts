import { EventEmitter } from "node:events";

const publicStatusEvents = new EventEmitter();
publicStatusEvents.setMaxListeners(200);

export function onPublicStatusChanged(listener: () => void) {
  publicStatusEvents.on("changed", listener);
  return () => publicStatusEvents.off("changed", listener);
}

export function emitPublicStatusChanged() {
  publicStatusEvents.emit("changed");
}
