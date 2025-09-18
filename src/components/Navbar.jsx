import React, { useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";

export default function Navbar() {
  const { user, logout } = useContext(AuthContext);
  const nav = useNavigate();

  const doLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <header className="w-full bg-gray-900/95 border-b border-gray-800 shadow-lg sticky top-0 z-50">
      <div className="flex items-center justify-between h-16 w-full px-4 md:px-8">
        <div className="flex items-center">
          <Link
            to="/"
            className="text-2xl font-extrabold text-indigo-400 tracking-tight select-none"
          >
            HireDude
          </Link>
        </div>
        <nav className="flex items-center gap-4">
          <Link
            to="/"
            className="text-base text-gray-300 hover:text-indigo-400 font-medium px-3 py-1 rounded transition"
          >
            Home
          </Link>
          {!user && (
            <>
              <Link
                to="/login"
                className="text-base text-gray-300 hover:text-indigo-400 font-medium px-3 py-1 rounded transition"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="text-base text-gray-300 hover:text-indigo-400 font-medium px-3 py-1 rounded transition"
              >
                Signup
              </Link>
            </>
          )}
          {(!user || (user && user.role !== "candidate")) && (
            <Link
              to="/interviewer"
              className="text-base text-gray-300 hover:text-indigo-400 font-medium px-3 py-1 rounded transition"
            >
              Interviewer
            </Link>
          )}
          {(!user || user.role === "candidate") && (
            <Link
              to="/candidate"
              className="text-base text-gray-300 hover:text-indigo-400 font-medium px-3 py-1 rounded transition"
            >
              Candidate
            </Link>
          )}
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-base text-gray-300 font-semibold">
                {user.name}
              </span>
              <button
                onClick={doLogout}
                className="ml-2 px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-base text-white font-semibold shadow transition"
              >
                Logout
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
