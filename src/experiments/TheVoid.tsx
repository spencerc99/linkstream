import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "./useDocumentTitle";
import "./TheVoid.scss";

interface VoidMessage {
  id: string;
  text: string;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  startX: number;
  dx: number;
  dy: number;
}

const REACTION_EMOJIS = [
  "\uD83D\uDC4F",
  "\u2764\uFE0F",
  "\uD83D\uDD25",
  "\u2728",
  "\uD83D\uDCAF",
  "\uD83D\uDE4C",
  "\u2B50",
  "\uD83D\uDC96",
  "\uD83C\uDF89",
  "\uD83D\uDC95",
  "\uD83D\uDC40",
  "\uD83E\uDEE1",
];

function formatListeners(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function TheVoid() {
  useDocumentTitle("The Void");
  const [messages, setMessages] = useState<VoidMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [listeners, setListeners] = useState(0);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Passive listener growth
  useEffect(() => {
    const interval = setInterval(() => {
      setListeners((prev) => prev + Math.ceil(Math.random() * 2));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Faster growth when typing
  useEffect(() => {
    if (!isTyping) return;
    const interval = setInterval(() => {
      setListeners((prev) => prev + Math.ceil(Math.random() * 8));
    }, 400);
    return () => clearInterval(interval);
  }, [isTyping]);

  // Occasional spontaneous reactions after first message
  useEffect(() => {
    if (messages.length === 0) return;
    const interval = setInterval(() => {
      if (Math.random() < 0.3) {
        spawnReactions(1);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [messages.length > 0]);

  const spawnReactions = useCallback((count: number) => {
    const newReactions: FloatingReaction[] = Array.from(
      { length: count },
      (_, i) => ({
        id: `${Date.now()}-${i}-${Math.random()}`,
        emoji:
          REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)],
        startX: 20 + Math.random() * 60,
        dx: (Math.random() - 0.5) * 200,
        dy: -(200 + Math.random() * 300),
      })
    );
    setReactions((prev) => [...prev, ...newReactions]);
    // Clean up after animation ends
    setTimeout(() => {
      const ids = new Set(newReactions.map((r) => r.id));
      setReactions((prev) => prev.filter((r) => !ids.has(r.id)));
    }, 3000);
  }, []);

  const handleInputChange = (value: string) => {
    setInputText(value);
    setIsTyping(true);

    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => setIsTyping(false), 1000);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;

    const messageId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        text: inputText.trim(),
      },
    ]);

    // Remove message after float animation completes
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }, 8000);

    // Big listener jump
    setListeners((prev) => prev + 20 + Math.ceil(Math.random() * 80));

    // Burst of reactions
    spawnReactions(12 + Math.floor(Math.random() * 8));

    setInputText("");
    setIsTyping(false);
  };

  return (
    <div className="the-void" onClick={() => inputRef.current?.focus()}>
      <Link to="/" className="void-back">
        &larr;
      </Link>

      <div className="void-listener-count">
        <div className="listener-number" key={listeners}>
          {formatListeners(listeners)}
        </div>
        <div className="listener-label">listening</div>
        {isTyping && <div className="typing-pulse" />}
      </div>

      {messages.length === 0 && (
        <div className="void-waiting">...</div>
      )}

      <div className="void-messages">
        {messages.map((msg) => (
          <div key={msg.id} className="void-message">
            {msg.text}
          </div>
        ))}
      </div>

      <div className="void-reactions">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="floating-reaction"
            style={
              {
                left: `${r.startX}%`,
                "--dx": `${r.dx}px`,
                "--dy": `${r.dy}px`,
              } as React.CSSProperties
            }
          >
            {r.emoji}
          </div>
        ))}
      </div>

      <div className="void-input-area">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="speak into the void..."
          className="void-input"
          autoFocus
        />
      </div>
    </div>
  );
}
