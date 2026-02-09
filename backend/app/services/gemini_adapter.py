"""
Gemini Robotics 1.5 API Adapter
Primary: Gemini API for real AI planning
Fallback: Mock data when Gemini unavailable

Usage:
    adapter = GeminiGovernanceAdapter()
    result = await adapter.execute_command("Move to zone B", camera_feed, sensors)
    # Works with or without Gemini API key
"""

import asyncio
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel
import httpx
import random
import math

from app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# DATA MODELS
# ============================================================

class Position(BaseModel):
    x: float
    y: float
    z: float = 0.0


class RobotAction(BaseModel):
    action_type: str  # move, pick, place, rotate, stop
    trajectory: List[Dict[str, float]]
    target_object: Optional[str] = None
    estimated_duration_ms: int = 5000
    risk_factors: List[str] = []
    source: str = "gemini"  # "gemini" or "mock"


class SceneData(BaseModel):
    robot_position: Position
    humans: List[Dict[str, Any]] = []
    obstacles: List[Dict[str, Any]] = []
    objects: List[Dict[str, Any]] = []
    battery: float = 100.0


class GovernanceDecision(BaseModel):
    approved: bool
    action: str  # SAFE, SLOW, STOP, REPLAN
    risk_score: float
    violations: List[str] = []
    modified_trajectory: Optional[List[Dict]] = None
    reason: str = ""
    evaluation_time_ms: int = 0


# ============================================================
# GEMINI API CLIENT
# ============================================================

class GeminiRoboticsClient:
    """
    Client for Gemini Robotics 1.5 API.
    Returns None if API is unavailable (triggers fallback).
    """
    
    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.project_id = settings.gemini_project_id
        self.model = settings.gemini_model
        self.timeout = settings.gemini_timeout_s
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.client = httpx.AsyncClient(timeout=self.timeout)
        self.enabled = settings.gemini_configured
        
        if self.enabled:
            logger.info(f"✅ Gemini client initialized with model: {self.model}")
        else:
            logger.warning("⚠️ Gemini API key not configured - will use mock fallback")
    
    async def analyze_scene(self, camera_feed: bytes, sensor_data: Dict) -> Optional[Dict]:
        """
        Send scene data to Gemini for understanding.
        Returns None if Gemini unavailable.
        """
        if not self.enabled:
            return None
        
        try:
            import base64
            image_data = base64.b64encode(camera_feed).decode('utf-8') if camera_feed else ""
            
            response = await self.client.post(
                f"{self.base_url}/models/{self.model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json={
                    "contents": [{
                        "parts": [
                            {"inline_data": {"mime_type": "image/jpeg", "data": image_data}} if image_data else {},
                            {"text": """Analyze this robot scene. Return JSON with:
                            {
                                "humans": [{"id": "h1", "x": 0, "y": 0, "distance": 0}],
                                "obstacles": [{"id": "o1", "x": 0, "y": 0, "type": ""}],
                                "clear_path": true/false,
                                "risk_level": "low/medium/high"
                            }"""}
                        ]
                    }],
                    "generationConfig": {"response_mime_type": "application/json"}
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                return self._parse_gemini_response(result)
            else:
                logger.error(f"Gemini API error: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"Gemini analyze_scene failed: {e}")
            return None
    
    async def plan_action(self, scene: Dict, command: str) -> Optional[RobotAction]:
        """
        Ask Gemini to plan a robot action.
        Returns None if Gemini unavailable.
        """
        if not self.enabled:
            return None
        
        try:
            response = await self.client.post(
                f"{self.base_url}/models/{self.model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json={
                    "contents": [{
                        "parts": [{
                            "text": f"""You are a robot motion planner. 
                            
Scene: {json.dumps(scene)}

Command: {command}

Return JSON:
{{
    "action_type": "move|pick|place|rotate|stop",
    "trajectory": [{{"x": 0, "y": 0, "z": 0}}],
    "target_object": "object_name or null",
    "estimated_duration_ms": 5000,
    "risk_factors": ["factor1", "factor2"]
}}"""
                        }]
                    }],
                    "generationConfig": {"response_mime_type": "application/json"}
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                action_data = self._parse_gemini_response(result)
                if action_data:
                    return RobotAction(**action_data, source="gemini")
            else:
                logger.error(f"Gemini API error: {response.status_code}")
            
            return None
            
        except Exception as e:
            logger.error(f"Gemini plan_action failed: {e}")
            return None
    
    def _parse_gemini_response(self, response: Dict) -> Optional[Dict]:
        """Extract JSON from Gemini response."""
        try:
            candidates = response.get("candidates", [])
            if candidates:
                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                if parts:
                    text = parts[0].get("text", "")
                    return json.loads(text)
        except Exception as e:
            logger.error(f"Failed to parse Gemini response: {e}")
        return None


# ============================================================
# MOCK DATA GENERATOR (Fallback)
# ============================================================

class MockRobotPlanner:
    """
    Generates realistic mock robot actions when Gemini is unavailable.
    Used for demos, testing, and fallback.
    """
    
    def __init__(self):
        logger.info("🤖 Mock planner initialized as Gemini fallback")
    
    async def analyze_scene(self, sensor_data: Dict) -> Dict:
        """Generate mock scene analysis."""
        humans = []
        obstacles = []
        
        # Random chance of human detection
        if random.random() > 0.6:
            humans.append({
                "id": f"human_{random.randint(1, 99)}",
                "x": random.uniform(30, 70),
                "y": random.uniform(30, 70),
                "distance": random.uniform(1.0, 5.0),
                "velocity": random.uniform(0, 1.5)
            })
        
        # Random obstacle
        if random.random() > 0.7:
            obstacles.append({
                "id": f"obs_{random.randint(1, 99)}",
                "x": random.uniform(40, 60),
                "y": random.uniform(40, 60),
                "type": random.choice(["box", "pallet", "equipment"])
            })
        
        return {
            "humans": humans,
            "obstacles": obstacles,
            "clear_path": len(humans) == 0 and len(obstacles) == 0,
            "risk_level": "high" if humans else ("medium" if obstacles else "low")
        }
    
    async def plan_action(self, scene: Dict, command: str, robot_pos: Position) -> RobotAction:
        """Generate mock trajectory based on command."""
        
        target = self._parse_target_from_command(command)
        humans = scene.get("humans", [])
        obstacles = scene.get("obstacles", [])
        
        trajectory = []
        risk_factors = []
        action_type = "move"
        
        needs_avoidance = False
        avoidance_point = None
        
        for human in humans:
            hx, hy = human.get("x", 50), human.get("y", 50)
            if self._is_in_path(robot_pos.x, robot_pos.y, target["x"], target["y"], hx, hy):
                needs_avoidance = True
                risk_factors.append("human_in_path")
                avoidance_point = self._calculate_avoidance(robot_pos, target, hx, hy)
        
        for obs in obstacles:
            ox, oy = obs.get("x", 50), obs.get("y", 50)
            if self._is_in_path(robot_pos.x, robot_pos.y, target["x"], target["y"], ox, oy):
                needs_avoidance = True
                risk_factors.append("obstacle_in_path")
                if not avoidance_point:
                    avoidance_point = self._calculate_avoidance(robot_pos, target, ox, oy)
        
        trajectory.append({"x": robot_pos.x, "y": robot_pos.y, "z": 0})
        
        if needs_avoidance and avoidance_point:
            trajectory.append({"x": avoidance_point["x1"], "y": avoidance_point["y1"], "z": 0})
            trajectory.append({"x": avoidance_point["x2"], "y": avoidance_point["y2"], "z": 0})
        
        trajectory.append({"x": target["x"], "y": target["y"], "z": 0})
        
        command_lower = command.lower()
        if "pick" in command_lower or "grab" in command_lower:
            action_type = "pick"
        elif "place" in command_lower or "put" in command_lower:
            action_type = "place"
        elif "rotate" in command_lower or "turn" in command_lower:
            action_type = "rotate"
        elif "stop" in command_lower or "halt" in command_lower:
            action_type = "stop"
        
        return RobotAction(
            action_type=action_type,
            trajectory=trajectory,
            target_object=self._extract_object(command),
            estimated_duration_ms=len(trajectory) * 2000,
            risk_factors=risk_factors,
            source="mock"
        )
    
    def _parse_target_from_command(self, command: str) -> Dict[str, float]:
        command_lower = command.lower()
        zones = {
            "zone a": {"x": 20, "y": 50},
            "zone b": {"x": 80, "y": 50},
            "zone c": {"x": 50, "y": 20},
            "zone d": {"x": 50, "y": 80},
            "station": {"x": 75, "y": 50},
            "home": {"x": 10, "y": 50},
            "charging": {"x": 5, "y": 90},
        }
        for zone_name, coords in zones.items():
            if zone_name in command_lower:
                return coords
        return {"x": 75, "y": 50}
    
    def _is_in_path(self, x1: float, y1: float, x2: float, y2: float, px: float, py: float) -> bool:
        line_len = math.sqrt((x2-x1)**2 + (y2-y1)**2)
        if line_len == 0:
            return False
        dist = abs((y2-y1)*px - (x2-x1)*py + x2*y1 - y2*x1) / line_len
        return dist < 15
    
    def _calculate_avoidance(self, robot: Position, target: Dict, obs_x: float, obs_y: float) -> Dict:
        mid_y = (robot.y + target["y"]) / 2
        offset = -25 if obs_y > mid_y else 25
        return {
            "x1": obs_x - 15,
            "y1": obs_y + offset,
            "x2": obs_x + 15,
            "y2": obs_y + offset
        }
    
    def _extract_object(self, command: str) -> Optional[str]:
        objects = ["package", "box", "pallet", "item", "container", "crate"]
        for obj in objects:
            if obj in command.lower():
                return obj
        return None


# ============================================================
# MAIN ADAPTER (Gemini + Mock Fallback)
# ============================================================

class GeminiGovernanceAdapter:
    """
    Main integration point between Gemini/Mock and Governance.
    
    Flow:
    1. Try Gemini API first
    2. If Gemini fails/unavailable → Use mock data
    3. Send to governance for approval
    4. Return decision
    
    This ensures the system ALWAYS works, with or without Gemini.
    """
    
    def __init__(self, governance_api_url: str = "http://localhost:8080"):
        self.gemini = GeminiRoboticsClient()
        self.mock = MockRobotPlanner()
        self.governance_url = governance_api_url
        self.http = httpx.AsyncClient(timeout=10.0)
        
        logger.info(f"🚀 GeminiGovernanceAdapter initialized")
        logger.info(f"   ├─ Gemini: {'✅ Enabled' if self.gemini.enabled else '❌ Disabled (using mock)'}")
        logger.info(f"   ├─ Governance: {governance_api_url}")
        logger.info(f"   └─ Fallback: MockRobotPlanner")
    
    async def execute_command(
        self, 
        command: str, 
        camera_feed: bytes = b"",
        sensor_data: Dict = None,
        robot_position: Position = None
    ) -> Dict[str, Any]:
        """
        Full pipeline: Command → Plan (Gemini/Mock) → Governance → Result
        
        Always returns a result - never fails completely.
        """
        sensor_data = sensor_data or {}
        robot_position = robot_position or Position(x=25, y=50, z=0)
        
        start_time = datetime.utcnow()
        
        # Step 1: Analyze scene (Gemini or Mock)
        scene = await self._analyze_scene(camera_feed, sensor_data)
        
        # Step 2: Plan action (Gemini or Mock)
        planned_action = await self._plan_action(scene, command, robot_position)
        
        # Step 3: Evaluate with governance
        governance_decision = await self._evaluate_with_governance(
            action=planned_action,
            scene=scene,
            robot_position=robot_position
        )
        
        elapsed_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        
        # Step 4: Build response
        if governance_decision.approved:
            trajectory = governance_decision.modified_trajectory or planned_action.trajectory
            return {
                "status": "executing",
                "action": governance_decision.action,
                "trajectory": trajectory,
                "source": planned_action.source,
                "governance": governance_decision.model_dump(),
                "elapsed_ms": elapsed_ms
            }
        else:
            return {
                "status": "blocked",
                "action": governance_decision.action,
                "reason": governance_decision.reason,
                "source": planned_action.source,
                "governance": governance_decision.model_dump(),
                "elapsed_ms": elapsed_ms
            }
    
    async def _analyze_scene(self, camera_feed: bytes, sensor_data: Dict) -> Dict:
        """Try Gemini first, fall back to mock."""
        if self.gemini.enabled:
            scene = await self.gemini.analyze_scene(camera_feed, sensor_data)
            if scene:
                logger.debug("📷 Scene analyzed by Gemini")
                return scene
            logger.warning("⚠️ Gemini scene analysis failed, using mock")
        
        scene = await self.mock.analyze_scene(sensor_data)
        logger.debug("📷 Scene analyzed by Mock")
        return scene
    
    async def _plan_action(self, scene: Dict, command: str, robot_pos: Position) -> RobotAction:
        """Try Gemini first, fall back to mock."""
        if self.gemini.enabled:
            action = await self.gemini.plan_action(scene, command)
            if action:
                logger.debug(f"🎯 Action planned by Gemini: {action.action_type}")
                return action
            logger.warning("⚠️ Gemini action planning failed, using mock")
        
        action = await self.mock.plan_action(scene, command, robot_pos)
        logger.debug(f"🎯 Action planned by Mock: {action.action_type}")
        return action
    
    async def _evaluate_with_governance(
        self, 
        action: RobotAction, 
        scene: Dict,
        robot_position: Position
    ) -> GovernanceDecision:
        """Send action to governance API for approval."""
        start_time = datetime.utcnow()
        
        try:
            response = await self.http.post(
                f"{self.governance_url}/governance/evaluate",
                json={
                    "action_type": action.action_type,
                    "trajectory": action.trajectory,
                    "scene": {
                        "humans": scene.get("humans", []),
                        "obstacles": scene.get("obstacles", []),
                        "robot_position": robot_position.model_dump()
                    },
                    "risk_factors": action.risk_factors,
                    "source": action.source,
                    "timestamp": datetime.utcnow().isoformat()
                },
                timeout=5.0
            )
            
            eval_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            
            if response.status_code == 200:
                data = response.json()
                return GovernanceDecision(
                    approved=data.get("approved", False),
                    action=data.get("action", "STOP"),
                    risk_score=data.get("risk_score", 1.0),
                    violations=data.get("violations", []),
                    modified_trajectory=data.get("modified_trajectory"),
                    reason=data.get("reason", ""),
                    evaluation_time_ms=eval_time
                )
            else:
                logger.error(f"Governance API error: {response.status_code}")
                
        except Exception as e:
            logger.error(f"Governance evaluation failed: {e}")
        
        return GovernanceDecision(
            approved=False,
            action="STOP",
            risk_score=1.0,
            violations=["governance_unavailable"],
            reason="Could not reach governance API - blocking for safety",
            evaluation_time_ms=0
        )
    
    def get_status(self) -> Dict[str, Any]:
        """Return current adapter status."""
        return {
            "gemini_enabled": self.gemini.enabled,
            "gemini_model": self.gemini.model if self.gemini.enabled else None,
            "fallback": "mock",
            "governance_url": self.governance_url,
            "mode": "gemini" if self.gemini.enabled else "mock"
        }


# ============================================================
# FACTORY FUNCTION
# ============================================================

def create_adapter(governance_url: str = None) -> GeminiGovernanceAdapter:
    """
    Create adapter with proper configuration.
    
    Usage:
        adapter = create_adapter()
        result = await adapter.execute_command("Move to zone B", camera, sensors)
    """
    url = governance_url or f"http://localhost:{settings.backend_port}"
    return GeminiGovernanceAdapter(governance_api_url=url)


# ============================================================
# STANDALONE TESTING
# ============================================================

async def test_adapter():
    """Test the adapter with mock fallback."""
    adapter = create_adapter()
    print(f"\n{'='*50}")
    print(f"Adapter Status: {adapter.get_status()}")
    print(f"{'='*50}\n")
    
    result = await adapter.execute_command(
        command="Move to zone B and pick up the package",
        robot_position=Position(x=25, y=50)
    )
    
    print(f"Result:")
    print(f"  Status: {result['status']}")
    print(f"  Action: {result['action']}")
    print(f"  Source: {result['source']} {'(Gemini)' if result['source'] == 'gemini' else '(Mock Fallback)'}")
    print(f"  Time: {result['elapsed_ms']}ms")
    
    if result['status'] == 'executing':
        print(f"  Trajectory: {len(result['trajectory'])} waypoints")
    else:
        print(f"  Reason: {result['reason']}")


if __name__ == "__main__":
    asyncio.run(test_adapter())
