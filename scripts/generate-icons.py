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
    img = Image.new('RGB', (size, size), color='#000000')
    draw = ImageDraw.Draw(img)
    
    # Bookmark icon: vertical rectangle with rounded top corners and V-notch at bottom
    bookmark_width = size // 3
    bookmark_height = size * 2 // 3
    corner_radius = size // 12
    v_notch_size = size // 6
    outline_width = max(2, size // 16)
    
    # Calculate center position (vertically centered)
    bookmark_x = (size - bookmark_width) // 2
    bookmark_y = (size - bookmark_height) // 2
    
    # Draw rounded rectangle for top part (above the V-notch)
    top_rect_height = bookmark_height - v_notch_size
    draw.rounded_rectangle(
        [bookmark_x, bookmark_y, bookmark_x + bookmark_width, bookmark_y + top_rect_height],
        radius=corner_radius,
        fill='#ffffff',
        outline='#000000',
        width=outline_width
    )
    
    # Draw the V-notch at bottom (inverted triangle)
    notch_bottom_y = bookmark_y + bookmark_height
    notch_center_x = bookmark_x + bookmark_width // 2
    v_notch_points = [
        (bookmark_x, bookmark_y + top_rect_height),
        (notch_center_x, notch_bottom_y),
        (bookmark_x + bookmark_width, bookmark_y + top_rect_height)
    ]
    draw.polygon(v_notch_points, fill='#ffffff', outline='#000000', width=outline_width)
    
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


