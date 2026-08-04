"use client";

import { useState } from "react";
import Image from "next/image";
import { MoreVertical, Pencil, Trash2, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { editMessageAction, deleteMessageAction } from "@/app/(dashboard)/messages/actions";
import { cn } from "@/utils";
import type { Message } from "@/types";

export function MessageBubble({
  message,
  isOwn,
  onImageClick,
}: {
  message: Message;
  isOwn: boolean;
  onImageClick: (src: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const isDeleted = !!message.deletedAt;

  async function handleSaveEdit() {
    if (!draft.trim()) return;
    setIsSaving(true);
    const result = await editMessageAction({ messageId: message.id, content: draft.trim() });
    setIsSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setEditing(false);
  }

  async function handleDelete() {
    setMenuOpen(false);
    const result = await deleteMessageAction(message.id);
    if (!result.success) toast.error(result.error);
  }

  return (
    <div className={cn("group flex", isOwn ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[75%] items-end gap-1.5", isOwn && "flex-row-reverse")}>
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2.5 text-sm",
            isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            isDeleted && "italic text-muted-foreground"
          )}
        >
          {isDeleted ? (
            <p>Message deleted</p>
          ) : editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
                className="min-w-48 resize-none rounded-lg border-0 bg-background/20 p-2 text-sm text-inherit placeholder:text-inherit/60 focus:outline-none"
              />
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={handleSaveEdit} disabled={isSaving} className="underline">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(false)} className="underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.imageUrl && (
                <button
                  type="button"
                  onClick={() => onImageClick(message.imageUrl!)}
                  className="relative mb-1 block h-40 w-52 overflow-hidden rounded-lg"
                >
                  <Image src={message.imageUrl} alt="Shared image" fill sizes="208px" className="object-cover" />
                </button>
              )}
              {message.content && <p className="whitespace-pre-line">{message.content}</p>}
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px]",
                  isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                )}
              >
                {message.editedAt && <span>edited</span>}
                <span>
                  {new Date(message.createdAt).toLocaleTimeString("en-KE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {isOwn && (message.readAt ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
              </div>
            </>
          )}
        </div>

        {isOwn && !isDeleted && !editing && (
          <div className="relative opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Message options"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <>
                <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="glass absolute right-0 top-full z-20 mt-1 w-32 rounded-lg p-1">
                  {message.content && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
