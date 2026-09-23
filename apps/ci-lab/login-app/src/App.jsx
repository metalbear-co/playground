import { useState } from "react";

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json();
    if (!response.ok || !body.authenticated) {
      setResult(null);
      setError(body.message || "Login failed");
      return;
    }
    setResult(body);
  }

  return (
    <main>
      <h1>Account portal</h1>
      <p className="lede">Sign in with the account fetched from account-srvc.</p>
      <form onSubmit={onSubmit}>
        <label>
          Username
          <input
            aria-label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <p role="status">
          Signed in as {result.username}. {result.message}
        </p>
      ) : null}
    </main>
  );
}
