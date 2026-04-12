import { Routes, Route } from "react-router-dom";
import { StreamView } from "./StreamView";
import { HAHPage } from "./experiments/HAHPage";
import { FakeMessages } from "./experiments/FakeMessages";
import { FakePoster } from "./experiments/FakePoster";
import { TheVoid } from "./experiments/TheVoid";
import "./App.scss";

function App() {
  return (
    <Routes>
      <Route path="/" element={<StreamView />} />
      <Route path="/HAH" element={<HAHPage />} />
      <Route path="/HAH/messages" element={<FakeMessages />} />
      <Route path="/HAH/poster" element={<FakePoster />} />
      <Route path="/HAH/void" element={<TheVoid />} />
    </Routes>
  );
}

export default App;
