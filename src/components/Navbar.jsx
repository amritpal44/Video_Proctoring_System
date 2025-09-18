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
    <header className="bg-gray-800/60 backdrop-blur-md border-b border-gray-700">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="text-2xl font-semibold text-white">
              HireDude
            </Link>
          </div>
          <nav className="flex items-center gap-3">
            <Link to="/" className="text-sm text-gray-300 hover:text-white">
              Home
            </Link>
            {!user && (
              <>
                <Link
                  to="/login"
                  className="text-sm text-gray-300 hover:text-white"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="text-sm text-gray-300 hover:text-white"
                >
                  Signup
                </Link>
              </>
            )}
            {/* Only show interviewer link to interviewer/admin users */}
            {(!user || (user && user.role !== "candidate")) && (
              <Link
                to="/interviewer"
                className="text-sm text-gray-300 hover:text-white"
              >
                Interviewer
              </Link>
            )}
            {(!user || user.role === "candidate") && (
              <Link
                to="/candidate"
                className="text-sm text-gray-300 hover:text-white"
              >
                Candidate
              </Link>
            )}
            {user && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-300">{user.name}</span>
                <button
                  onClick={doLogout}
                  className="ml-2 px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm text-white"
                >
                  Logout
                </button>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
