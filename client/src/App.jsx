import React from "react";

const App = () => {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
      <div className="mx-auto max-w-2xl rounded-2xl  bg-slate-900 p-10 shadow-xl">
        <h1 className="mb-6 text-center text-4xl font-bold tracking-tight">
          Trading Bot
        </h1>

        <p className="mb-8 text-center text-lg leading-8 text-slate-300">
          Automate your trading with real-time market analysis and intelligent
          decision-making. Monitor trends, execute trades instantly, and
          optimize your strategy with data-driven insights — all in one place.
        </p>

        <div className="flex justify-center">
          <button className="rounded-lg bg-orange-500 px-20 py-3 text-base font-semibold text-white transition hover:bg-orange-600 cursor-pointer ">
            Login
          </button>
        </div>
      </div>
    </main>
  );
};

export default App;
