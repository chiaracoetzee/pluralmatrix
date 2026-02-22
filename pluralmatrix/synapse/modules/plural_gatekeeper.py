import logging
import json
import urllib.request
import urllib.error
from typing import Union, Dict, Any, Optional, Tuple, Mapping

from synapse.module_api import ModuleApi

logger = logging.getLogger(__name__)

def to_mutable(obj):
    """Recursively convert immutable types to standard mutable ones."""
    if isinstance(obj, Mapping):
        return {k: to_mutable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [to_mutable(i) for i in obj]
    else:
        return obj

class PluralGatekeeper:
    def __init__(self, config: Dict[str, Any], api: ModuleApi):
        self.api = api
        self.service_url = config.get("service_url", "http://app-service:9000/check")
        self.bot_id = config.get("bot_id", "@plural_bot:localhost")
        
        # Register the Third Party Rules callback
        self.api.register_third_party_rules_callbacks(
            check_event_allowed=self.check_event_allowed
        )

        logger.info(f"PluralGatekeeper Bare-Minimum-Rewrite loaded.")

    async def check_event_allowed(self, event: Any, context: Mapping[Tuple[str, str], Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
        try:
            event_type = getattr(event, "type", "")
            if event_type != "m.room.message":
                return (True, None)

            # 1. ALWAYS prepare the mutable dict immediately
            event_dict = to_mutable(event.get_dict())
            
            raw_content = getattr(event, "content", {})
            content = to_mutable(raw_content) 
            
            if content.get("msgtype") != "m.text":
                return (True, event_dict)

            sender = getattr(event, "sender", "")
            if sender.startswith("@_plural_") or sender == self.bot_id: 
                return (True, event_dict)

            # 2. Ask App Service
            room_id = getattr(event, "room_id", "")
            payload = json.dumps({
                "sender": sender,
                "content": content,
                "room_id": room_id
            }).encode("utf-8")

            req = urllib.request.Request(
                self.service_url, 
                data=payload, 
                headers={'Content-Type': 'application/json'}
            )
            
            with urllib.request.urlopen(req, timeout=2.0) as response:
                result = json.load(response)
                
                if result.get("action") == "BLOCK":
                    logger.info(f"[Rewrite] Proxy matched. Truncating body.")
                    
                    # 3. BARE MINIMUM: Just blank the body
                    if "content" in event_dict:
                        event_dict["content"]["body"] = "" 
                        if "formatted_body" in event_dict["content"]:
                            event_dict["content"]["formatted_body"] = ""
                    
                    return (True, event_dict)
                
                return (True, event_dict)

        except Exception as e:
            logger.error(f"[Rewrite] Failure: {e}")
            try:
                return (True, to_mutable(event.get_dict()))
            except:
                return (True, None)

    @staticmethod
    def parse_config(config: Dict[str, Any]) -> Dict[str, Any]:
        return config
