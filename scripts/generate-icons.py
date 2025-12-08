#!/usr/bin/env python3
"""Generate simple icons for TubeNotes Chrome extension"""

try:
    from PIL import Image, ImageDraw, ImageFont
    has_pil = True
except ImportError:
    has_pil = False
    import base64

def create_icon_pil(size):
    """Create icon using PIL"""
    img = Image.new('RGB', (size, size), color='#3ea6ff')
    draw = ImageDraw.Draw(img)
    
    # Draw a simple pin/note icon
    # Draw pin shape (rounded rectangle with triangle bottom)
    margin = size // 6
    pin_width = size - 2 * margin
    pin_height = (size - 2 * margin) * 2 // 3
    
    # Main rectangle
    draw.rounded_rectangle(
        [margin, margin, margin + pin_width, margin + pin_height],
        radius=size // 12,
        fill='#ffffff'
    )
    
    # Triangle bottom
    triangle_points = [
        (margin + pin_width // 3, margin + pin_height),
        (margin + pin_width * 2 // 3, margin + pin_height),
        (margin + pin_width // 2, size - margin)
    ]
    draw.polygon(triangle_points, fill='#ffffff')
    
    return img

def create_icon_base64(size):
    """Create minimal valid PNG using base64 (fallback)"""
    # This is a minimal 1x1 blue pixel PNG in base64
    # For a real extension, you'd want to replace these with proper icons
    png_data = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
    return png_data

def main():
    import os
    import sys
    
    # Get script directory and project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, 'icons')
    
    os.makedirs(icons_dir, exist_ok=True)
    
    sizes = [16, 48, 128]
    
    for size in sizes:
        icon_path = os.path.join(icons_dir, f'icon{size}.png')
        
        if has_pil:
            try:
                img = create_icon_pil(size)
                img.save(icon_path, 'PNG')
                print(f'Created {icon_path}')
            except Exception as e:
                print(f'Error creating icon with PIL: {e}')
                # Fallback to base64
                with open(icon_path, 'wb') as f:
                    f.write(create_icon_base64(size))
        else:
            # Use base64 fallback
            with open(icon_path, 'wb') as f:
                f.write(create_icon_base64(size))
            print(f'Created placeholder {icon_path} (install Pillow for better icons: pip install Pillow)')
    
    print('\nIcons generated! For better icons, install Pillow: pip install Pillow')

if __name__ == '__main__':
    main()


