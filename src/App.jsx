import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";

import InterviewScreen from "./components/InterviewScreen";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <InterviewScreen
        candidateName="Amritpal Singh"
        backendUrl="http://localhost:4000"
      />
    </>
  );
}

export default App;
