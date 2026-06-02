import { Routes, Route, Navigate } from "react-router-dom";
import { StreamView } from "./StreamView";
import { NotebookPage } from "./experiments/NotebookPage";
import { FakeMessages } from "./experiments/FakeMessages";
import { FakePoster } from "./experiments/FakePoster";
import { TheVoid } from "./experiments/TheVoid";
import "./App.scss";

function App() {
  return (
    <Routes>
      <Route path="/" element={<NotebookPage />} />
      <Route path="/HAH" element={<Navigate to="/" replace />} />
      <Route path="/HAH/linkstream" element={<StreamView />} />
      <Route path="/HAH/messages" element={<FakeMessages />} />
      <Route path="/HAH/poster" element={<FakePoster />} />
      <Route path="/HAH/void" element={<TheVoid />} />
    </Routes>
  );
}

export default App;
