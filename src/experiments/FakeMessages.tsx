import { useState, useCallback, useRef, useEffect } from "react";
import { useJetStream } from "../hooks/useJetStream";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import "./FakeMessages.scss";

const CONTACTS = [
  { id: 1, name: "Sarah", color: "#FF6B6B", weight: 5 },
  { id: 2, name: "Alex K.", color: "#4ECDC4", weight: 3 },
  { id: 3, name: "Jordan", color: "#45B7D1", weight: 4 },
  { id: 4, name: "Sam", color: "#96CEB4", weight: 2 },
  { id: 5, name: "Casey", color: "#FFD93D", weight: 3 },
  { id: 6, name: "Riley M.", color: "#C9B1FF", weight: 1 },
  { id: 7, name: "Morgan", color: "#98D8C8", weight: 2 },
  { id: 8, name: "Taylor", color: "#F4A261", weight: 4 },
  { id: 9, name: "Jamie", color: "#FF9FF3", weight: 1 },
  { id: 10, name: "Drew", color: "#54A0FF", weight: 1 },
];

const TAPBACK_REACTIONS = ["\u2764\uFE0F", "\uD83D\uDC4D", "\uD83D\uDC4E", "\uD83D\uDE02", "\u203C\uFE0F", "\u2753"];

// Weighted random: contacts with higher weight appear more often
const WEIGHTED_CONTACTS = CONTACTS.flatMap((c) => Array(c.weight).fill(c));

interface Message {
  id: string;
  text: string;
  timestamp: number;
  fromContact: boolean;
  reaction?: string;
  sourceDid?: string;
  sourceRkey?: string;
}

interface Conversation {
  contact: (typeof CONTACTS)[0];
  messages: Message[];
  unreadCount: number;
  isTyping: boolean;
}

interface IncomingPost {
  text: string;
  did: string;
  rkey: string;
}

function isTextLikePost(data: any): IncomingPost | null {
  const record = data.commit?.record;
  if (!record?.text) return null;
  if (record.embed) return null;
  if (record.reply) return null;

  // Language filter: if langs is declared, require English
  if (Array.isArray(record.langs) && record.langs.length > 0) {
    if (!record.langs.some((l: string) => l.toLowerCase().startsWith("en"))) {
      return null;
    }
  }

  let text = record.text as string;

  // Strip hashtags to make it feel more like a text message
  text = text.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();

  if (text.length > 160 || text.length < 2) return null;
  if (text.startsWith("@") || text.startsWith("RT ")) return null;
  if (text.includes("http://") || text.includes("https://")) return null;

  // Fallback ASCII check for posts that didn't declare a language
  if (!record.langs) {
    const asciiCount = text
      .split("")
      .filter((c) => c.charCodeAt(0) < 128).length;
    if (asciiCount / text.length < 0.7) return null;
  }

  const did = data.did as string | undefined;
  const rkey = data.commit?.rkey as string | undefined;
  if (!did || !rkey) return null;

  return { text, did, rkey };
}

export function FakeMessages() {
  const [conversations, setConversations] = useState<
    Map<number, Conversation>
  >(() => {
    const map = new Map<number, Conversation>();
    CONTACTS.forEach((contact) => {
      map.set(contact.id, {
        contact,
        messages: [],
        unreadCount: 0,
        isTyping: false,
      });
    });
    return map;
  });
  const [activeContactId, setActiveContactId] = useState<number>(
    CONTACTS[0].id
  );
  const [inputText, setInputText] = useState("");
  const [showTapback, setShowTapback] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingMessages = useRef<
    {
      contactId: number;
      text: string;
      timestamp: number;
      did: string;
      rkey: string;
    }[]
  >([]);
  const lastMessageTime = useRef(0);
  const activeContactIdRef = useRef(activeContactId);

  // Keep ref in sync with state
  useEffect(() => {
    activeContactIdRef.current = activeContactId;
  }, [activeContactId]);

  // Auto scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeContactId]);

  // Process pending messages: show typing indicator, then deliver message
  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingMessages.current.length > 0) {
        const msg = pendingMessages.current.shift()!;
        setConversations((prev) => {
          const next = new Map(prev);
          const conv = next.get(msg.contactId);
          if (!conv) return prev;
          const updated = { ...conv };
          updated.isTyping = false;
          updated.messages = [
            ...updated.messages.slice(-100),
            {
              id: `${msg.contactId}-${Date.now()}-${Math.random()}`,
              text: msg.text,
              timestamp: msg.timestamp,
              fromContact: true,
              sourceDid: msg.did,
              sourceRkey: msg.rkey,
            },
          ];
          if (msg.contactId !== activeContactIdRef.current) {
            updated.unreadCount += 1;
          }
          next.set(msg.contactId, updated);
          return next;
        });
      }
    }, 350 + Math.random() * 500);
    return () => clearInterval(interval);
  }, []);

  const handleFirehoseMessage = useCallback((data: any) => {
    const now = Date.now();
    // Variable throttle: 2-6 seconds between messages
    if (now - lastMessageTime.current < 400 + Math.random() * 900) return;

    const post = isTextLikePost(data);
    if (!post) return;

    lastMessageTime.current = now;

    const contact =
      WEIGHTED_CONTACTS[Math.floor(Math.random() * WEIGHTED_CONTACTS.length)];

    // Show typing indicator
    setConversations((prev) => {
      const next = new Map(prev);
      const conv = next.get(contact.id);
      if (!conv) return prev;
      next.set(contact.id, { ...conv, isTyping: true });
      return next;
    });

    pendingMessages.current.push({
      contactId: contact.id,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
    });
  }, []);

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleFirehoseMessage,
    onConnectionChange: () => {},
  });

  const activeConversation = conversations.get(activeContactId);

  const handleSend = () => {
    if (!inputText.trim()) return;
    setConversations((prev) => {
      const next = new Map(prev);
      const conv = next.get(activeContactId);
      if (!conv) return prev;
      next.set(activeContactId, {
        ...conv,
        messages: [
          ...conv.messages,
          {
            id: `user-${Date.now()}`,
            text: inputText.trim(),
            timestamp: Date.now(),
            fromContact: false,
          },
        ],
      });
      return next;
    });
    setInputText("");
  };

  const handleSelectConversation = (contactId: number) => {
    setActiveContactId(contactId);
    setShowTapback(null);
    setConversations((prev) => {
      const next = new Map(prev);
      const conv = next.get(contactId);
      if (!conv || conv.unreadCount === 0) return prev;
      next.set(contactId, { ...conv, unreadCount: 0 });
      return next;
    });
  };

  const handleTapback = (messageId: string, reaction: string) => {
    setConversations((prev) => {
      const next = new Map(prev);
      const conv = next.get(activeContactId);
      if (!conv) return prev;
      next.set(activeContactId, {
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === messageId
            ? { ...m, reaction: m.reaction === reaction ? undefined : reaction }
            : m
        ),
      });
      return next;
    });
    setShowTapback(null);
  };

  // Sort: typing first, then by most recent message, then alphabetical
  const sortedConversations = Array.from(conversations.values()).sort(
    (a, b) => {
      if (a.isTyping && !b.isTyping) return -1;
      if (!a.isTyping && b.isTyping) return 1;
      const aLast = a.messages.length
        ? a.messages[a.messages.length - 1].timestamp
        : 0;
      const bLast = b.messages.length
        ? b.messages[b.messages.length - 1].timestamp
        : 0;
      return bLast - aLast;
    }
  );

  const totalUnread = Array.from(conversations.values()).reduce(
    (sum, c) => sum + c.unreadCount,
    0
  );

  return (
    <div className="fake-messages">
      <div className="messages-sidebar">
        <div className="sidebar-header">
          <Link to="/HAH" className="back-button">
            &lsaquo;
          </Link>
          <h1>Messages</h1>
          {totalUnread > 0 && (
            <span className="total-unread">{totalUnread}</span>
          )}
        </div>
        <div className="conversation-list">
          {sortedConversations.map((conv) => (
            <div
              key={conv.contact.id}
              className={`conversation-item ${conv.contact.id === activeContactId ? "active" : ""}`}
              onClick={() => handleSelectConversation(conv.contact.id)}
            >
              <div
                className="contact-avatar"
                style={{ backgroundColor: conv.contact.color }}
              >
                {conv.contact.name[0]}
              </div>
              <div className="conversation-preview">
                <div className="conversation-top">
                  <span className="contact-name">{conv.contact.name}</span>
                  {conv.messages.length > 0 && (
                    <span className="message-time">
                      {dayjs(
                        conv.messages[conv.messages.length - 1].timestamp
                      ).format("h:mm A")}
                    </span>
                  )}
                </div>
                <div className="conversation-bottom">
                  <span className="last-message">
                    {conv.isTyping ? (
                      <em className="typing-preview">typing...</em>
                    ) : conv.messages.length > 0 ? (
                      <>
                        {!conv.messages[conv.messages.length - 1].fromContact && (
                          <span className="you-prefix">You: </span>
                        )}
                        {conv.messages[conv.messages.length - 1].text.slice(
                          0,
                          35
                        )}
                        {conv.messages[conv.messages.length - 1].text.length >
                        35
                          ? "\u2026"
                          : ""}
                      </>
                    ) : null}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="unread-badge">{conv.unreadCount}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="messages-main">
        <div className="chat-header">
          <div
            className="contact-avatar small"
            style={{ backgroundColor: activeConversation?.contact.color }}
          >
            {activeConversation?.contact.name[0]}
          </div>
          <span className="chat-contact-name">
            {activeConversation?.contact.name}
          </span>
        </div>

        <div className="messages-body" onClick={() => setShowTapback(null)}>
          <div className="messages-date-header">Today</div>
          {activeConversation?.messages.map((msg, i) => {
            const prevMsg = activeConversation.messages[i - 1];
            const showTimestamp =
              !prevMsg || msg.timestamp - prevMsg.timestamp > 300000;
            return (
              <div key={msg.id}>
                {showTimestamp && i > 0 && (
                  <div className="message-timestamp">
                    {dayjs(msg.timestamp).format("h:mm A")}
                  </div>
                )}
                <div
                  className={`message-row ${msg.fromContact ? "incoming" : "outgoing"}`}
                >
                  <div
                    className={`message-bubble ${msg.fromContact ? "incoming" : "outgoing"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTapback(
                        showTapback === msg.id ? null : msg.id
                      );
                    }}
                  >
                    {msg.text}
                    {msg.reaction && (
                      <span className="message-reaction">{msg.reaction}</span>
                    )}
                  </div>
                  {msg.fromContact && msg.sourceDid && msg.sourceRkey && (
                    <a
                      className="source-link"
                      href={`https://bsky.app/profile/${msg.sourceDid}/post/${msg.sourceRkey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View original post on Bluesky"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                  {showTapback === msg.id && (
                    <div className="tapback-menu">
                      {TAPBACK_REACTIONS.map((r) => (
                        <button
                          key={r}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTapback(msg.id, r);
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {activeConversation?.isTyping && (
            <div className="message-row incoming">
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="message-input-area">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="iMessage"
            className="message-input"
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!inputText.trim()}
          >
            &uarr;
          </button>
        </div>
      </div>
    </div>
  );
}
