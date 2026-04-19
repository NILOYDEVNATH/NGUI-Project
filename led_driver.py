#!/usr/bin/env python3
"""
LED Matrix Driver
Renders text on Adafruit RGB LED matrices
"""

import sys
import time
import argparse
from PIL import Image, ImageDraw, ImageFont

try:
    from adafruit_circuitpython_rpi_rgb_matrix import RGBMatrix, graphics
    HAS_LED_MATRIX = True
except ImportError:
    HAS_LED_MATRIX = False
    print("⚠️  Warning: adafruit_circuitpython_rpi_rgb_matrix not installed", file=sys.stderr)


class LEDDisplay:
    def __init__(self, rows=32, cols=64, brightness=100):
        self.rows = rows
        self.cols = cols
        self.brightness = brightness
        self.matrix = None
        
        if HAS_LED_MATRIX:
            try:
                self.matrix = RGBMatrix(
                    rows=rows,
                    cols=cols,
                    brightness=brightness,
                    gpio_slowdown=2,
                    disable_hardware_pulsing=True
                )
            except Exception as e:
                print(f"Failed to initialize LED matrix: {e}", file=sys.stderr)
    
    def render_text(self, text, r=255, g=255, b=255):
        """Render text on the LED matrix"""
        try:
            # Create image
            image = Image.new("RGB", (self.cols, self.rows), color=(0, 0, 0))
            draw = ImageDraw.Draw(image)
            
            # Try to use a nice font
            try:
                font = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    size=14
                )
            except:
                try:
                    font = ImageFont.truetype(
                        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                        size=14
                    )
                except:
                    font = ImageFont.load_default()
            
            # Wrap text if needed
            max_width = self.cols - 4
            wrapped_text = wrap_text(text, max_width, draw, font)
            
            # Measure text
            bbox = draw.textbbox((0, 0), wrapped_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            # Center text
            x = max(2, (self.cols - text_width) // 2)
            y = max(2, (self.rows - text_height) // 2)
            
            # Draw text
            draw.text((x, y), wrapped_text, font=font, fill=(r, g, b))
            
            # Display on matrix
            if self.matrix:
                self.matrix.SetImage(image)
            else:
                # Fallback: print to console
                print(f"[LED MOCK] {text} RGB({r},{g},{b})", file=sys.stderr)
        
        except Exception as e:
            print(f"Error rendering text: {e}", file=sys.stderr)
    
    def clear(self):
        """Clear the display"""
        try:
            image = Image.new("RGB", (self.cols, self.rows), color=(0, 0, 0))
            if self.matrix:
                self.matrix.SetImage(image)
        except Exception as e:
            print(f"Error clearing display: {e}", file=sys.stderr)


def wrap_text(text, max_width, draw, font):
    """Wrap text to fit within max_width"""
    words = text.split()
    lines = []
    current_line = ""
    
    for word in words:
        test_line = current_line + (" " if current_line else "") + word
        bbox = draw.textbbox((0, 0), test_line, font=font)
        test_width = bbox[2] - bbox[0]
        
        if test_width <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    
    if current_line:
        lines.append(current_line)
    
    return "\n".join(lines[:3])  # Max 3 lines


def main():
    parser = argparse.ArgumentParser(description='Display text on LED matrix')
    parser.add_argument('text', help='Text to display')
    parser.add_argument('--red', type=int, default=255, help='Red component (0-255)')
    parser.add_argument('--green', type=int, default=255, help='Green component (0-255)')
    parser.add_argument('--blue', type=int, default=255, help='Blue component (0-255)')
    parser.add_argument('--rows', type=int, default=32, help='Matrix rows')
    parser.add_argument('--cols', type=int, default=64, help='Matrix columns')
    parser.add_argument('--brightness', type=int, default=100, help='Brightness 0-100')
    parser.add_argument('--duration', type=float, default=1.0, help='Display duration in seconds')
    
    # Support positional args for backward compatibility
    if len(sys.argv) > 1 and sys.argv[1].isdigit() == False:
        # Called with: python3 led_driver.py "text" r g b
        text = sys.argv[1] if len(sys.argv) > 1 else "Hello"
        r = int(sys.argv[2]) if len(sys.argv) > 2 else 255
        g = int(sys.argv[3]) if len(sys.argv) > 3 else 255
        b = int(sys.argv[4]) if len(sys.argv) > 4 else 255
        args = argparse.Namespace(text=text, red=r, green=g, blue=b, 
                                 rows=32, cols=64, brightness=100, duration=1.0)
    else:
        args = parser.parse_args()
    
    # Clamp values
    r = max(0, min(255, args.red))
    g = max(0, min(255, args.green))
    b = max(0, min(255, args.blue))
    brightness = max(0, min(100, args.brightness))
    
    try:
        display = LEDDisplay(args.rows, args.cols, brightness)
        display.render_text(args.text, r, g, b)
        
        # Keep display on for specified duration
        time.sleep(args.duration)
        
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
    finally:
        if display:
            display.clear()


if __name__ == '__main__':
    main()
