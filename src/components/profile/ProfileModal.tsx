"use client";

import { useState } from "react";

type ProfileModalProps = {
    onClose: () => void;
};

type ProfileForm = {
    displayName: string;
    email: string;
    bio: string;
};

export default function ProfileModal({ onClose }: ProfileModalProps) {
    // Local draft and saved profile states allow edit/cancel without a backend yet.
    const [isEditing, setIsEditing] = useState(false);
    const [savedProfile, setSavedProfile] = useState<ProfileForm>({
        displayName: "User Name",
        email: "user@example.com",
        bio: "A new member of the Elevator Office.",
    });
    const [profileForm, setProfileForm] = useState<ProfileForm>({
        displayName: "User Name",
        email: "user@example.com",
        bio: "A new member of the Elevator Office.",
    });

    // Keep all form updates type-safe and reusable across profile fields.
    function updateProfileField(field: keyof ProfileForm, value: string) {
        setProfileForm((currentProfile) => ({
            ...currentProfile,
            [field]: value,
        }));
    }

    // The overlay closes from the backdrop while the dialog stops event propagation.
    return (
        <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/30 p-6 backdrop-blur-xs"
            role="presentation"
            onMouseDown={onClose}
        >
            <section
                className="relative rounded-lg w-full max-w-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl sm:p-8"
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="absolute right-4 top-4 text-2xl leading-none text-slate-400 transition hover:text-slate-900"
                    aria-label="Close profile"
                    onClick={onClose}
                >
                    &times;
                </button>

                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-600">
                    Account
                </p>

                <h2 id="profile-modal-title" className="mt-3 text-3xl font-bold tracking-tight">
                    Profile
                </h2>

                <div className="mt-8 flex items-center gap-5">
                    <div className="rounded-full grid size-20 shrink-0 place-items-center bg-emerald-100 text-2xl font-bold text-emerald-700">
                        U
                    </div>

                    {isEditing ? (
                        <div className="flex w-full flex-col gap-4">
                            <label className="flex flex-col gap-2 text-sm font-medium text-slate-600">
                                Display name
                                <input
                                    type="text"
                                    value={profileForm.displayName}
                                    onChange={(event) => updateProfileField("displayName", event.target.value)}
                                    className="border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                />
                            </label>

                            <label className="flex flex-col gap-2 text-sm font-medium text-slate-600">
                                Email
                                <input
                                    type="email"
                                    value={profileForm.email}
                                    onChange={(event) => updateProfileField("email", event.target.value)}
                                    className="border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                />
                            </label>

                            <label className="flex flex-col gap-2 text-sm font-medium text-slate-600">
                                Bio
                                <textarea
                                    value={profileForm.bio}
                                    onChange={(event) => updateProfileField("bio", event.target.value)}
                                    rows={3}
                                    className="resize-none border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                />
                            </label>
                        </div>
                    ) : (
                        <div>
                            <h3 className="text-xl font-semibold">{profileForm.displayName}</h3>
                            <p className="mt-1 text-slate-500">{profileForm.email}</p>
                        </div>
                    )}
                </div>

                {!isEditing && <p className="mt-6 text-sm leading-6 text-slate-500">{profileForm.bio}</p>}

                <div className="mt-8 flex gap-3">
                    <button
                        type="button"
                        className="rounded-lg flex-1 bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700"
                        onClick={() => {
                            if (isEditing) {
                                setSavedProfile(profileForm);
                            }

                            setIsEditing((currentValue) => !currentValue);
                        }}
                    >
                        {isEditing ? "Save changes" : "Edit profile"}
                    </button>

                    {isEditing && (
                        <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-5 py-3 font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                            onClick={() => {
                                setProfileForm(savedProfile);
                                setIsEditing(false);
                            }}
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}