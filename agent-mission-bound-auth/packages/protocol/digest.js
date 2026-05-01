import { createHash, createHmac, randomBytes } from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256Hex(value) {
  const input = typeof value === "string" ? value : canonicalize(value);
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret, value) {
  return createHmac("sha256", secret).update(canonicalize(value)).digest("hex");
}

export function id(prefix, value) {
  return `${prefix}_${sha256Hex(value).slice(0, 24)}`;
}

export function randomSalt(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

export function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}
