import type { FastifyReply } from "fastify";

export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  type = "invalid_request_error",
) {
  return reply.status(statusCode).send({
    error: {
      message,
      type,
      code: statusCode,
    },
  });
}
