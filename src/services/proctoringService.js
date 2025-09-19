// frontend/src/services/proctoringService.js

const API_BASE = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

export class ProctoringService {
  constructor() {
    this.eventQueue = [];
    this.batchSize = 10;
    this.flushInterval = 5000; // 5 seconds
    this.flushTimer = null;
  }

  async createProctorEvent(sessionId, interviewId, event) {
    try {
      const response = await fetch(`${API_BASE}/api/proctor/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          sessionId,
          interviewId,
          type: event.type,
          details: event.details,
          severity:
            event.details?.severity || this.calculateSeverity(event.type),
          timestamp: event.timestamp,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to create proctor event:", error);
      throw error;
    }
  }

  // Batch events for better performance
  queueEvent(sessionId, interviewId, event) {
    this.eventQueue.push({
      sessionId,
      interviewId,
      event,
      timestamp: new Date().toISOString(),
    });

    if (this.eventQueue.length >= this.batchSize) {
      this.flushEvents();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(
        () => this.flushEvents(),
        this.flushInterval
      );
    }
  }

  async flushEvents() {
    if (this.eventQueue.length === 0) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      await fetch(`${API_BASE}/api/proctor/events/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ events: eventsToSend }),
      });
    } catch (error) {
      console.error("Failed to flush events:", error);
      // Re-queue events on failure
      this.eventQueue = [...eventsToSend, ...this.eventQueue];
    }
  }

  calculateSeverity(eventType) {
    const severityMap = {
      no_face_detected: 3,
      multiple_faces_detected: 3,
      suspicious_object_detected: 2,
      looking_away: 2,
      models_loaded: 0,
      detection_started: 0,
      detection_stopped: 0,
    };

    return severityMap[eventType] || 1;
  }

  async getEventsByInterview(interviewId) {
    try {
      const response = await fetch(
        `${API_BASE}/api/proctor/events?interviewId=${interviewId}`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to fetch events:", error);
      throw error;
    }
  }

  async getIntegrityScore(interviewId) {
    try {
      const response = await fetch(
        `${API_BASE}/api/proctor/score/${interviewId}`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to fetch integrity score:", error);
      throw error;
    }
  }

  destroy() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushEvents(); // Flush remaining events
    }
  }
}

export default new ProctoringService();
