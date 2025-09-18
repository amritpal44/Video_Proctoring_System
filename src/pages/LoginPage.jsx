import React, { useState, useContext } from "react";
import { AuthContext } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const { login } = useContext(AuthContext);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    const res = await login(email, password);
    if (res.ok) {
      nav("/");
    } else {
      setError(res.error || "Login failed");
    }
  };
  return (
    <div className="max-w-md mx-auto mt-12 bg-gray-800 rounded-lg p-6 shadow-md">
      <h2 className="text-2xl font-semibold mb-4 text-white">Sign in</h2>
      <form onSubmit={submit} className="space-y-4">
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
            Login
          </button>
          <a
            className="text-sm text-gray-400 hover:text-gray-200"
            href="/signup"
          >
            Create account
          </a>
        </div>
      </form>
      {error && <div className="text-red-400 mt-3">{error}</div>}
    </div>
  );
}
