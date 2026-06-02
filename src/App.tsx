import { Routes, Route } from "react-router-dom";
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
      <Route path="/linkstream" element={<StreamView />} />
      <Route path="/messages" element={<FakeMessages />} />
      <Route path="/poster" element={<FakePoster />} />
      <Route path="/void" element={<TheVoid />} />
    </Routes>
  );
}

export default App;
