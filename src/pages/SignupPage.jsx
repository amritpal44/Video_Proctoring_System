import React, { useState, useContext } from "react";
import { AuthContext } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export default function SignupPage() {
  const { login } = useContext(AuthContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const nav = useNavigate();
  const backend = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  const submit = async (e) => {
    e.preventDefault();
    // register as candidate only
    const res = await fetch(`${backend}/api/auth/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role: "candidate" }),
    });
    const j = await res.json();
    if (res.ok && j.user) {
      // auto-login by calling login to refresh context (cookie already set)
      await login(email, password);
      nav("/");
    } else {
      setError(j.error || "signup failed");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 bg-gray-800 rounded-lg p-6 shadow-md">
      <h2 className="text-2xl font-semibold mb-4 text-white">Create account</h2>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Name</label>
          <input
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-100"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Email</label>
          <input
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-100"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Password</label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-100"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            type="submit"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white"
          >
            Sign up
          </button>
          <a
            className="text-sm text-gray-400 hover:text-gray-200"
            href="/login"
          >
            Already have an account?
          </a>
        </div>
      </form>
      {error && <div className="text-red-400 mt-3">{error}</div>}
    </div>
  );
}
