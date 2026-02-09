import React from "react";
import "./globals.css";

export const metadata = {
  title: "Sovereign Robotics Ops",
  description: "AI Governance for Autonomous Robots - Track 1: Autonomous Robotics Control in Simulation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-900 text-white min-h-screen">
        {/* Navigation */}
        <nav className="border-b border-slate-700 bg-slate-800/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {/* Logo */}
                <a href="/" className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/30">
                    <span className="text-white font-bold text-lg">S</span>
                  </div>
                  <div>
                    <div className="font-bold text-white">Sovereign Robotics Ops</div>
                    <div className="text-xs text-slate-400">Track 1: Autonomous Control</div>
                  </div>
                </a>
                
                {/* Nav Links */}
                <div className="hidden md:flex items-center gap-4 ml-8">
                  <a href="/" className="text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-700/50">
                    Dashboard
                  </a>
                  <a href="/demo" className="text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-700/50">
                    Demo
                  </a>
                  <a href="/policies" className="text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-700/50">
                    Policies
                  </a>
                </div>
              </div>
              
              {/* Status */}
              <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1.5 rounded-full border border-green-500/30">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-green-400 font-medium">Governance Active</span>
              </div>
            </div>
          </div>
        </nav>
        
        {/* Main Content */}
        <main>
          {children}
        </main>
        
        {/* Footer */}
        <footer className="border-t border-slate-700 mt-8 py-6">
          <div className="max-w-7xl mx-auto px-4 flex justify-between text-sm text-slate-500">
            <span>Sovereign AI Labs • The Robot Conscience</span>
            <span>Ready for Gemini Robotics 1.5</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
