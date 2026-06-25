from dataclasses import dataclass, field

@dataclass
class Chunk:
    note_id: str
    chunk_index: int
    heading_path: str
    text: str
    context: str = ""           # filled by contextualize step
    has_context: bool = False
    def has_context_text(self) -> str:
        return f"{self.context}\n\n{self.text}".strip() if self.context else self.text

@dataclass
class RetrievedChunk:
    chunk_id: str
    note_id: str
    text: str
    heading_path: str
    score: float
    why: str
