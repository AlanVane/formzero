#!/usr/bin/env python3
"""Minimal SMTP sink for local verification of FormZero notification emails.

Accepts any message on 127.0.0.1:1025 without TLS or AUTH and appends each one
to a log file. Enough to read what the app actually generates; it is not a
mail server and never delivers anything.

Usage:
    python3 scripts/smtp-sink.py [--port 1025] [--out /tmp/smtp/messages.log]

Then point the app at it (see docs/local-verification.md).
"""

import argparse
import socketserver
import sys
import time


class Handler(socketserver.StreamRequestHandler):
    out = "/tmp/smtp/messages.log"

    def send(self, line):
        self.wfile.write((line + "\r\n").encode())
        self.wfile.flush()

    def note(self, msg):
        print(f"[sink] {msg}", flush=True)

    def handle(self):
        self.note(f"connect from {self.client_address}")
        self.send("220 localhost ESMTP sink")
        sender = None
        rcpt = []
        while True:
            raw = self.rfile.readline()
            if not raw:
                break
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            upper = line.upper()
            if upper.startswith("EHLO"):
                self.send("250-localhost greets you")
                self.send("250-8BITMIME")
                # No STARTTLS and no AUTH on purpose: nodemailer then sends in
                # the clear, which keeps this usable without credentials.
                self.send("250 SIZE 26214400")
            elif upper.startswith("HELO"):
                self.send("250 localhost")
            elif upper.startswith("MAIL FROM"):
                sender = line
                self.send("250 OK")
            elif upper.startswith("RCPT TO"):
                rcpt.append(line)
                self.send("250 OK")
            elif upper.startswith("DATA"):
                self.send("354 End data with <CR><LF>.<CR><LF>")
                chunks = []
                while True:
                    data = self.rfile.readline()
                    if not data:
                        break
                    text = data.decode("utf-8", "replace")
                    # Only "." terminates: a bare CRLF separates headers from
                    # the body and must be kept.
                    if text.rstrip("\r\n") == ".":
                        break
                    if text.startswith(".."):
                        text = text[1:]
                    chunks.append(text)
                self.persist(sender, rcpt, "".join(chunks))
                self.send("250 OK queued")
                sender, rcpt = None, []
            elif upper.startswith("QUIT"):
                self.send("221 Bye")
                break
            elif upper.startswith("RSET"):
                sender, rcpt = None, []
                self.send("250 OK")
            else:
                self.send("250 OK")
        self.note(f"disconnect {self.client_address}")

    def persist(self, sender, rcpt, body):
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(self.out, "a", encoding="utf-8") as f:
            f.write(f"\n===== MESSAGE {stamp} =====\n")
            f.write(f"ENVELOPE-FROM: {sender}\n")
            f.writelines(f"ENVELOPE-TO: {r}\n" for r in rcpt)
            f.write(body)
            f.write("===== END =====\n")
        self.note(f"stored {len(body)} bytes -> {self.out}")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1025)
    parser.add_argument("--out", default="/tmp/smtp/messages.log")
    args = parser.parse_args()

    Handler.out = args.out
    open(args.out, "w").close()
    with Server((args.host, args.port), Handler) as srv:
        print(f"[sink] listening on {args.host}:{args.port} -> {args.out}", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == "__main__":
    main()
