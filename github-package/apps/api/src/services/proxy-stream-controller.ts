import type { FastifyReply } from "fastify";
import { isClosedControllerError } from "./proxy-errors.js";

export function createSafeStreamController(
  controller: ReadableStreamDefaultController<Uint8Array>,
  reply: FastifyReply,
) {
  let closed = false;

  const isReplyClosed = () => reply.raw.destroyed || reply.raw.writableEnded;

  return {
    enqueue(value: Uint8Array) {
      if (closed || isReplyClosed()) {
        closed = true;
        return false;
      }

      try {
        controller.enqueue(value);
        return true;
      } catch (error) {
        if (isClosedControllerError(error)) {
          closed = true;
          return false;
        }

        throw error;
      }
    },
    error(error: unknown) {
      if (closed || isReplyClosed()) {
        closed = true;
        return;
      }

      try {
        controller.error(error);
      } catch (controllerError) {
        if (!isClosedControllerError(controllerError)) {
          throw controllerError;
        }
      } finally {
        closed = true;
      }
    },
    close() {
      if (closed || isReplyClosed()) {
        closed = true;
        return;
      }

      try {
        controller.close();
      } catch (error) {
        if (!isClosedControllerError(error)) {
          throw error;
        }
      } finally {
        closed = true;
      }
    },
  };
}
