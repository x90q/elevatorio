import { FormEvent, useState } from "react";

type ChatModalProps = {
    onClose: () => void;
};

type Conversation = {
    id: string;
    type: ChatType;
    name: string;
    location: string;
    preview: string;
    online: boolean;
};

type ChatType = "Global" | "Floor" | "Room" | "DM";

type Message = {
    id: number;
    conversationId: string;
    author: string;
    avatar: string;
    text: string;
    time: string;
};

// Temporary conversation fixtures; replace these with API or realtime subscriptions later.
const conversations: Conversation[] = [
    {
        id: "lobby",
        type: "Global",
        name: "Lobby group",
        location: "Floor 00",
        preview: "Anyone up for coffee?",
        online: true,
    },
    {
        id: "maya",
        type: "DM",
        name: "Maya Chen",
        location: "Floor 03",
        preview: "The meeting room is free.",
        online: true,
    },
    {
        id: "design",
        type: "Floor",
        name: "Design floor",
        location: "Floor 05",
        preview: "New room is open today.",
        online: false,
    },
];

// Local seed messages keep the chat interaction testable before persistence is added.
const initialMessages: Message[] = [
    {
        id: 1,
        conversationId: "maya",
        author: "Maya Chen",
        avatar: "MC",
        text: "Hey! Are you already in the building?",
        time: "09:41",
    },
    {
        id: 2,
        conversationId: "maya",
        author: "You",
        avatar: "YU",
        text: "Just arrived at the lobby.",
        time: "09:42",
    },
    {
        id: 3,
        conversationId: "maya",
        author: "Maya Chen",
        avatar: "MC",
        text: "The meeting room is free on floor 03.",
        time: "09:43",
    },
    {
        id: 4,
        conversationId: "alex",
        author: "Alex Rivera",
        avatar: "AR",
        text: "The new room layout looks great.",
        time: "Yesterday",
    },
];

// Derive compact avatars from participant names when no image is available.
function getInitials(name: string) {
    return name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

export default function ChatModal({ onClose }: ChatModalProps) {
    // Chat state controls the selected tab, conversation, draft, and local message history.
    const [activeConversation, setActiveConversation] = useState("");
    const [activeChatType, setActiveChatType] = useState<ChatType>("DM");
    const [messages, setMessages] = useState(initialMessages);
    const [draft, setDraft] = useState("");
    const activeChat = conversations.find((conversation) => conversation.id === activeConversation);

    // Append a local message now; this is the seam for a future chat API or websocket.
    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const text = draft.trim();

        if (!text) {
            return;
        }

        setMessages((currentMessages) => [
            ...currentMessages,
            {
                id: Date.now(),
                conversationId: activeConversation,
                author: "You",
                avatar: "YU",
                text,
                time: "now",
            },
        ]);
        setDraft("");
    }

    // Switching chat scopes selects the first matching conversation when one exists.
    function handleChatTypeChange(chatType: ChatType) {
        setActiveChatType(chatType);
        if (chatType === "DM") {
            setActiveConversation("");
            return;
        }

        const nextConversation = conversations.find((conversation) => conversation.type === chatType);
        setActiveConversation(nextConversation?.id ?? "");
    }

    // Only messages belonging to the active conversation are rendered.
    const activeMessages = messages.filter((message) => message.conversationId === activeConversation);

    // The modal separates navigation, conversation content, and message composition.
    return (
        <section
            className="fixed bottom-2 left-2 top-18 z-20 flex w-full max-w-md flex-col overflow-hidden border border-slate-300 bg-white text-slate-900 shadow-2xl rounded-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-modal-title"
        >
            <div className="flex min-h-0 flex-1 flex-col">
                <header className="border-b border-slate-200 bg-white px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                {activeChatType === "DM" && activeChat && (
                                    <button
                                        type="button"
                                        className="text-lg leading-none text-slate-400 transition hover:text-slate-900"
                                        aria-label="Back to direct messages"
                                        onClick={() => setActiveConversation("")}
                                    >
                                        &larr;
                                    </button>
                                )}
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-600">Building chat</p>
                                    <h2 id="chat-modal-title" className="mt-1 text-lg font-bold">{activeChat?.name ?? (activeChatType === "DM" ? "Direct messages" : activeChatType)}</h2>
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="text-2xl leading-none text-slate-400 transition hover:text-slate-900"
                            aria-label="Close chat"
                            onClick={onClose}
                        >
                            &times;
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{activeChat?.location ?? "Choose a conversation"}</p>
                </header>

                <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-slate-50 p-2">
                    {(["Global", "Floor", "Room", "DM"] as ChatType[]).map((chatType) => (
                        <button
                            key={chatType}
                            type="button"
                            className={`rounded-md px-2 py-2 text-xs font-semibold transition ${activeChatType === chatType
                                ? "bg-white text-emerald-700 shadow-sm"
                                : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                                }`}
                            onClick={() => handleChatTypeChange(chatType)}
                        >
                            {chatType}
                        </button>
                    ))}
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto bg-[#f7f9f6] p-4">
                    {activeChatType === "DM" && !activeChat ? (
                        <div className="space-y-2">
                            <p className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your conversations</p>
                            {conversations.filter((conversation) => conversation.type === "DM").map((conversation) => (
                                <button
                                    key={conversation.id}
                                    type="button"
                                    className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-emerald-300"
                                    onClick={() => setActiveConversation(conversation.id)}
                                >
                                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                                        {getInitials(conversation.name)}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <strong className="block text-sm font-semibold">{conversation.name}</strong>
                                        <span className="mt-1 block truncate text-xs text-slate-500">{conversation.preview}</span>
                                    </span>
                                    <span className={`size-2 rounded-full ${conversation.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                                </button>
                            ))}
                        </div>
                    ) : activeChat ? activeMessages.map((message) => {
                        const isOwnMessage = message.author === "You";

                        return (
                            <div key={message.id} className={`flex items-end gap-2 ${isOwnMessage ? "justify-end" : "justify-start"}`}>
                                {!isOwnMessage && (
                                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                                        {message.avatar}
                                    </span>
                                )}
                                <div className={`flex max-w-[78%] flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
                                    {!isOwnMessage && <span className="mb-1 px-1 text-xs font-semibold text-slate-500">{message.author}</span>}
                                    <p className={`rounded-2xl px-3 py-2 text-sm leading-5 ${isOwnMessage ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"}`}>
                                        {message.text}
                                    </p>
                                    <span className="mt-1 px-1 text-[10px] text-slate-400">{message.time}</span>
                                </div>
                                {isOwnMessage && (
                                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-800 text-[10px] font-bold text-white">
                                        {message.avatar}
                                    </span>
                                )}
                            </div>
                        );
                    }) : (
                        <p className="py-10 text-center text-sm text-slate-400">No conversations yet.</p>
                    )}
                </div>

                {activeChat && <form className="flex gap-2 border-t border-slate-200 bg-white p-3" onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Write a message..."
                        aria-label="Message"
                        className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                    <button
                        type="submit"
                        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!draft.trim()}
                    >
                        Send
                    </button>
                </form>}
            </div>
        </section>
    );
}