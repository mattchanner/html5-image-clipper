/**
 * Copyright (C) 1993-2013 ID Business Solutions Limited
 *
 * Created by: Matt Channer
 */
(function(global) {

    // polyfill
    var requestAnimationFrame =
        window.requestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (cb) {
            // fall back to timeout with a 60 FPS refresh rate
            setTimeout(cb, 1000 / 60);
        };

    window.requestAnimationFrame = requestAnimationFrame;

    var TOP_LEFT = 1,
        TOP_RIGHT = 2,
        BOTTOM_LEFT = 3,
        BOTTOM_RIGHT = 4,
        NO_RESIZER = -1;

    /*
     * Constructs a new Matrix instance with either a source 2d array (3x3), or
     * 6 individual arguments (a, b, c, d, tx, ty) which form the top 2 rows
     * of the matrix:
     *
     * | a,  c,  tx |
     * | b,  d,  ty |
     * | 0,  0,  1  |
     */
    var Matrix = function (/* arguments */) {
        if (arguments.length === 1 && arguments[0].length) {
            var im = arguments[0];
            this.m = [[im[0][0], im[0][1], im[0][2]],
                      [im[1][0], im[1][1], im[1][2]],
                      [im[2][0], im[2][1], im[2][2]]];
        } else if (arguments.length === 6) {
            this.m = [[arguments[0], arguments[2], arguments[4]],
                      [arguments[1], arguments[3], arguments[5]],
                      [0, 0, 1]];
        }
    };

    Matrix.prototype = {
        constructor: Matrix,
        a: function a ()   { return this.m[0][0]; },
        b: function b ()   { return this.m[1][0]; },
        c: function c ()   { return this.m[0][1]; },
        d: function d ()   { return this.m[1][1]; },
        tx: function tx () { return this.m[0][2]; },
        ty: function ty () { return this.m[1][2]; },
        height: function height () { return 3; },
        width:  function width () { return 3; },
        mul: function mul (other) {
            var result = [], i, j, k;
            for (i = 0; i < this.height(); i++) {
                result[i] = [];
                for (j = 0; j < other.width(); j++) {
                    var sum = 0;
                    for (k = 0; k < this.width(); k++) {
                        sum += this.m[i][k] * other.m[k][j];
                    }
                    result[i][j] = sum;
                }
            }
            return new Matrix(
                result[0][0],
                result[1][0],
                result[0][1],
                result[1][1],
                result[0][2],
                result[1][2]);
        },
        toString: function () {
            return "matrix(" + this.a() + ", " + this.b() + ", " +
                    this.c() + ", " + this.d() + ", " + Math.floor(this.tx()) + ", " +
                    Math.floor(this.ty()) + ")";
        }
    };

    Matrix.identity = function () {
        return new Matrix(1, 0, 0, 1, 0, 0);
    };

    Matrix.rotate = function (degrees) {
        // important - toFixed is used here in order
        // to prevent values falling bellow a set threshold
        // otherwise the browser will fail to parse and render
        var radians = degrees * Math.PI / 180,
            a = Math.cos(radians).toFixed(5),
            b = Math.sin(radians).toFixed(5),
            c = -b,
            d = a;

        return new Matrix(a, b, c, d, 0, 0);
    };

    Matrix.translate = function (tx, ty) {
        return new Matrix(1, 0, 0, 1, tx, ty);
    };

    Matrix.scale = function (s) {
        return new Matrix(s, 0, 0, s, 0, 0);
    };

    var Vector = (function (x, y) {
        this.x = x;
        this.y = y;
        this.m = [[x], [y], [1]];
    });

    Vector.prototype = {
        constructor: Vector,
        height: function () { return 3; },
        width: function () { return 1; },
        x: function () { return this.x; },
        y: function () { return this.y; }
    };

    /**
     * Represents a basic rectangle type
     */
    var Rect = (function (srcX, srcY, srcX2, srcY2) {

        var x  = srcX  || -1,
            y  = srcY  || -1,
            x2 = srcX2 || -1,
            y2 = srcY2 || -1;

        return {
            x:        x,
            y:        y,
            x2:       x2,
            y2:       y2,
            width:    function () { return Math.abs(this.x2 - this.x); },
            height:   function () { return Math.abs(this.y2 - this.y); },
            left:     function () { return Math.min(this.x, this.x2); },
            top:      function () { return Math.min(this.y, this.y2); },
            right:    function () { return Math.max(this.x, this.x2); },
            bottom:   function () { return Math.max(this.y, this.y2); },
            isEmpty:  function () { return this.width() <= 0 || this.height() <= 0; },
            toString: function () { return [this.x, this.y, this.x2, this.y2].join(","); },
            contains: function (pt) {
                return pt.x >= this.left() && pt.x <= this.right() &&
                       pt.y >= this.top() && pt.y <= this.bottom();
            },
            clone: function () {
                return new Rect(this.x, this.y, this.x2, this.y2);
            },
            move: function(transX, transY) {
                this.x += transX;
                this.x2 += transX;

                this.y += transY;
                this.y2 += transY;
            },
            scale: function (factor) {
                var scaleMatrix = Matrix.scale(factor, factor),
                    m1 = scaleMatrix.mul(new Vector(this.x, this.y)),
                    m2 = scaleMatrix.mul(new Vector(this.x2, this.y2));
                this.x = m1.a();
                this.y = m1.b();
                this.x2 = m2.a();
                this.y2 = m2.b();
            }
        };
    });

    /**
     * Handles mouse events in order to track the position of a drawn
     * clip rectangle, with support for resizing and moving a drawn rectangle
     * around the screen
     */
    var Tracker = (function (opt) {

        var defaults = {
            onStart: function () {},
            onEnd: function (args) {},
            onMove: function (args) {},
            resizable: true,
            draggable: true,
            anchorSize: 10,
            moveIncrement: 4,
            zoom: 1.0,
            $el: null
        };

        var options = $.extend(defaults, opt),
            mouseIsDown = false,
            isDragging = false,
            isResizing = false,
            startX,
            startY,
            dragOffsetX,
            dragOffsetY,
            dragOffsetX2,
            dragOffsetY2,
            viewPort = new Rect(),
            currentResizer = NO_RESIZER,

            // cached rectangles to prevent new instance creation on
            // every mouse move event
            topLeftRect = new Rect(),
            topRightRect = new Rect(),
            bottomLeftRect = new Rect(),
            bottomRightRect = new Rect();

        var pointToClient = function (event) {
            return {
                x: event.pageX - options.$el.offset().left,
                y: event.pageY - options.$el.offset().top
            };
        };

        var getTopLeftAnchorRect = function () {

            topLeftRect.x = viewPort.left() - options.anchorSize / 2;
            topLeftRect.y = viewPort.top()  - options.anchorSize / 2;
            topLeftRect.x2 = viewPort.left() + options.anchorSize;
            topLeftRect.y2 = viewPort.top() + options.anchorSize;

            return topLeftRect;
        };

        var getTopRightAnchorRect = function () {

            topRightRect.x = viewPort.right() - options.anchorSize / 2;
            topRightRect.y = viewPort.top()   - options.anchorSize / 2;
            topRightRect.x2 = viewPort.right() + options.anchorSize;
            topRightRect.y2 = viewPort.top()   + options.anchorSize;

            return topRightRect;
        };

        var getBottomRightAnchorRect = function () {

            bottomRightRect.x = viewPort.right()  - options.anchorSize / 2;
            bottomRightRect.y = viewPort.bottom() - options.anchorSize / 2;
            bottomRightRect.x2 = viewPort.right()  + options.anchorSize;
            bottomRightRect.y2 = viewPort.bottom() + options.anchorSize;

            return bottomRightRect;
        };

        var getBottomLeftAnchorRect = function () {

            bottomLeftRect.x = viewPort.left()   - options.anchorSize / 2;
            bottomLeftRect.y = viewPort.bottom() - options.anchorSize / 2;
            bottomLeftRect.x2 = viewPort.left()   + options.anchorSize;
            bottomLeftRect.y2 = viewPort.bottom() + options.anchorSize;

            return bottomLeftRect;
        };

        var resizerByPoint = function (pt) {

            if (getBottomLeftAnchorRect().contains(pt))
                return BOTTOM_LEFT;

            if (getBottomRightAnchorRect().contains(pt))
                return BOTTOM_RIGHT;

            if (getTopRightAnchorRect().contains(pt))
                return TOP_RIGHT;

            if (getTopLeftAnchorRect().contains(pt))
                return TOP_LEFT;

            return NO_RESIZER;
        };

        var resizeTopLeft = function (pt) {

            viewPort.y = pt.y;
            viewPort.x = pt.x;
        };

        var resizeTopRight = function (pt) {

            viewPort.x2 = pt.x;
            viewPort.y  = pt.y;
        };

        var resizeBottomRight = function (pt) {

            viewPort.x2 = pt.x;
            viewPort.y2 = pt.y;
        };

        var resizeBottomLeft = function (pt) {

            viewPort.y2 = pt.y;
            viewPort.x  = pt.x;
        };


        var leftArrowPressed = function () {
            if (viewPort.isEmpty())
                return;

            viewPort.move(-options.moveIncrement, 0);
            options.onEnd();
        };

        var rightArrowPressed = function () {
            if (viewPort.isEmpty())
                return;

            viewPort.move(options.moveIncrement, 0);
            options.onEnd();
        };

        var upArrowPressed = function () {
            if (viewPort.isEmpty())
                return;

            viewPort.move(0, -options.moveIncrement);
            options.onEnd();
        };

        var downArrowPressed = function () {
            if (viewPort.isEmpty())
                return;

            viewPort.move(0, options.moveIncrement);
            options.onEnd();
        };

        var isPointInCanvas = function (pt) {

            return (pt.x >= 0 &&
                    pt.y >= 0 &&
                    pt.x < options.$el.width() &&
                    pt.y < options.$el.height());
        };

        var mousemove = function (event) {

            event.preventDefault(); event.stopPropagation();

            var pt = pointToClient(event), cursor = 'move';

            if (viewPort.contains(pt) && options.draggable) {
                cursor = 'move';
            } else if (options.resizable && getTopLeftAnchorRect().contains(pt))  {
                cursor = 'nw-resize';
            } else if (options.resizable && getTopRightAnchorRect().contains(pt))  {
                cursor = 'ne-resize';
            } else if (options.resizable && getBottomLeftAnchorRect().contains(pt))  {
                cursor = 'sw-resize';
            } else if (options.resizable && getBottomRightAnchorRect().contains(pt))  {
                cursor = 'se-resize';
            } else if (options.drawable) {
                cursor = 'crosshair';
            }

            options.$el.css("cursor", cursor);

            if (!mouseIsDown) { return; }

            var deltaX = pt.x - startX,
                deltaY = pt.y - startY;

            if (isResizing) {
                switch (currentResizer) {
                    case TOP_LEFT:
                        resizeTopLeft(pt);
                        break;
                    case TOP_RIGHT:
                        resizeTopRight(pt);
                        break;
                    case BOTTOM_RIGHT:
                        resizeBottomRight(pt);
                        break;
                    case BOTTOM_LEFT:
                        resizeBottomLeft(pt);
                        break;
                }
            }
            else if (isDragging) {

                // dragOffset is the offset from the top corner of the clip rect recorded
                // when the mouse was initially clicked.  The clip rect coordinates are therefore
                // moved by the same offset
                var moveOffsetX = pt.x - dragOffsetX,
                    moveOffsetY = pt.y - dragOffsetY,
                    moveOffsetX2 = pt.x - dragOffsetX2,
                    moveOffsetY2 = pt.y - dragOffsetY2;

                viewPort.x = moveOffsetX;
                viewPort.y = moveOffsetY;

                viewPort.x2 = moveOffsetX2;
                viewPort.y2 = moveOffsetY2;

            } else {

                viewPort.x = Math.min(pt.x, startX);
                viewPort.y = Math.min(pt.y, startY);

                viewPort.x2 = viewPort.x + Math.abs(deltaX);
                viewPort.y2 = viewPort.y + Math.abs(deltaY);
            }

            options.onMove(viewPort);

            return false;
        };

        var mouseup = function (event) {

            event.preventDefault(); event.stopPropagation();

            mouseIsDown = false;
            isDragging = false;

            options.onEnd(viewPort);

            options.$el.attr("tabindex", "0");
            options.$el.focus();

            return false;
        };

        var mousedown = function (event) {

            event.preventDefault(); event.stopPropagation();

            mouseIsDown = true;

            var pt = pointToClient(event);

            startX = pt.x;
            startY = pt.y;

            currentResizer = resizerByPoint(pt);

            isDragging = options.draggable && viewPort.contains(pt);
            isResizing = options.resizable && (currentResizer !== NO_RESIZER);

            if (!isDragging && !isResizing && options.drawable) {

                viewPort.x = pt.x;
                viewPort.y = pt.y;
                viewPort.x2 = viewPort.x;
                viewPort.y2 = viewPort.y;

                dragOffsetX = viewPort.x;
                dragOffsetY = viewPort.y;

            } else if (!isResizing && options.draggable) {

                dragOffsetX = pt.x - viewPort.x;
                dragOffsetY = pt.y - viewPort.y;
                dragOffsetX2 = pt.x - viewPort.x2;
                dragOffsetY2 = pt.y - viewPort.y2;
            }

            options.onStart(viewPort);

            return false;
        };

        var my = function () {};

        my.isCropping = function () { return mouseIsDown; };
        my.isDragging = function () { return isDragging; };
        my.isResizing = function () { return isResizing; };

        my.onMouseMove = mousemove;
        my.onMouseDown = mousedown;
        my.onMouseUp = mouseup;
        my.onLeftArrow = leftArrowPressed;
        my.onRightArrow = rightArrowPressed;
        my.onUpArrow = upArrowPressed;
        my.onDownArrow = downArrowPressed;

        my.draggable = function () { return options.draggable; };
        my.drawable  = function () { return options.drawable; };
        my.resizable = function () { return options.resizable; };

        my.setDraggable = function (d) { options.draggable = d; };
        my.setDrawable  = function (d) { options.drawable = d; };
        my.setResizable = function (d) { options.resizable = d; };

        my.scale = function (factor) {
            viewPort.scale(factor);
            options.onEnd();
        };

        my.viewPort = viewPort;

        return my;
    });

    /**
     * The main publicly visible pan and zoom class, used for drawing
     * an image on a canvas, handling image cropping and rotation.
     */
    var PanAndZoomCanvas = (function (opt) {

        /*
         * The object to be returned by this constructor function. This is the
         * public face of this instance. All other data is private to the object
         */
        var my = function () {};

        var defaults = {
            sourceRect:   { x: -1, y: -1, x2: -1, y2: -1 },
            rotation:     0,
            selector:     'img',
            clipStroke:   'navy',
            dragStroke:   'red',
            resizeStroke: 'green',
            background:   'rgba(0, 0, 0, 0.1)',
            maskColour:   'rgba(0, 0, 0, 0.4)',
            lineWidth:    2,
            anchorSize:   5,
            onChange:     function () {},
            shadowBlur:   10,
            shadowColour: 'rgba(0,0,0,0.5)',
            imagePadding: 1.55,
            resizable: true,
            draggable: true,
            drawable: true
        };

        var options = $.extend(defaults, opt),
            rotation = options.rotation || 0,
            targetRotation = rotation;

        var paint = function () {
            window.requestAnimationFrame(function () {
                drawImage();
                drawViewPort();
            });
        };

        var canvas = document.createElement("canvas"),
            previewCanvas = document.createElement("canvas"),
            $canvas = $(canvas),
            $previewCanvas = $(previewCanvas),
            ctx = canvas.getContext("2d"),
            previewCtx = previewCanvas.getContext("2d"),
            $image = $(options.selector),
            isAnimating = false,
            tracker = new Tracker({
                $el: $canvas,
                onStart: paint,
                onEnd: function () {
                    paint();
                    options.onChange.call(options.onChange, my);
                },
                onMove: paint,
                anchorSize: options.anchorSize,
                resizable: options.resizable,
                draggable: options.draggable,
                drawable: options.drawable
            });

        // Remove any classes from the image that may cause the width and height to be reported incorrectly
        $image.attr("class", "");

        var initialRect = new Rect(
            options.sourceRect.x,
            options.sourceRect.y,
            options.sourceRect.x2,
            options.sourceRect.y2);

        if (!initialRect.isEmpty()) {
            tracker.viewPort.x = initialRect.x;
            tracker.viewPort.y = initialRect.y;
            tracker.viewPort.x2 = initialRect.x2;
            tracker.viewPort.y2 = initialRect.y2;
        }

        $canvas.on("mousemove", tracker.onMouseMove);
        $canvas.on("mousedown", tracker.onMouseDown);
        $canvas.on("mouseup",   tracker.onMouseUp);

        var doKeyDown = function (e) {

            var handled = false;

            switch (e.keyCode) {
                case 37: // LEFT
                    tracker.onLeftArrow();
                    handled = true;
                    break;
                case 38: // UP
                    tracker.onUpArrow();
                    handled = true;
                    break;
                case 39: // RIGHT
                    tracker.onRightArrow();
                    handled = true;
                    break;
                case 40: // DOWN
                    tracker.onDownArrow(); handled = true;
                    break;
            }

            return !handled;
        };

        $canvas.keydown(doKeyDown);

        /*
         * Replaces the image in the visible area of the DOM with
         * the canvas element
         */
        var adopt = function (image, canvas) {

            var length = Math.max(image[0].width, image[0].height);

            canvas.css("top",     image.offset().top)
                  .css("left",    image.offset().left)
                  .attr("width",  length * options.imagePadding)
                  .attr("height", length * options.imagePadding);

            image.hide();
            image.parent().append(canvas);
        };

        /*
         * Draws a circle into the main canvas context
         */
        var circle = function (cx, cy, rx, ry) {

            ctx.lineWidth = 0;
            ctx.save();

            ctx.beginPath();
            ctx.translate(cx - rx, cy - ry);
            ctx.scale(rx, ry);
            ctx.arc(1, 1, 1, 0, 2 * Math.PI, false);
            ctx.restore();
            ctx.stroke();

            ctx.fill();
        };

        /*
         * Returns the colour to use for the stroke and fill of
         * the clip rectangle based on the current state of the tracker
         */
        var getStrokeAndFill = function () {

            var isResizing = false;

            if (tracker.isResizing() && isResizing) {
                return options.resizeStroke;
            }

            if (tracker.isDragging()) {
                return options.dragStroke;
            }

            return options.clipStroke;
        };

        /*
         * Draws a masked clip rectangle into the canvas based on the current
         * clip rectangle drawn by the user
         */
        var drawViewPort = function () {

            var c = tracker.viewPort;
            var halfAnchor = options.anchorSize / 2;

            if (!isAnimating && !c.isEmpty() || tracker.isCropping()) {

                ctx.shadowBlur = 0;
                ctx.fillStyle = options.maskColour;

                // fill the area of the screen not covered by the clip rect
                ctx.fillRect(0, 0, $canvas.width(), c.top());
                ctx.fillRect(0, c.top(), c.left(), $canvas.height());
                ctx.fillRect(c.right(), c.top(), $canvas.width(), $canvas.height());
                ctx.fillRect(c.left(), c.bottom(), c.width(), $canvas.height() - c.top());

                ctx.strokeStyle = getStrokeAndFill();
                ctx.lineWidth = options.lineWidth;
                ctx.lineJoin = "round";

                ctx.shadowBlur = 1;
                ctx.shadowColor = options.shadowColour;

                ctx.strokeRect(c.left(), c.top(), c.width(), c.height());

                if (tracker.resizable()) {
                    ctx.fillStyle = ctx.strokeStyle;

                    circle(c.left(), c.top(), halfAnchor, halfAnchor);
                    circle(c.right(), c.top(), halfAnchor, halfAnchor);
                    circle(c.left(), c.bottom(), halfAnchor, halfAnchor);
                    circle(c.right(), c.bottom(), halfAnchor, halfAnchor);
                }
            }
        };

        /*
         * Draws a rotated image into the given canvas
         */
        var drawImageRotated = function (context, canvas, image, degrees) {

            var radians = degrees * Math.PI / 180,
                imageWidth = image[0].width,
                imageHeight = image[0].height,
                centerImageX = imageWidth / 2,
                centerImageY = imageHeight / 2,
                centerCanvasX = canvas.width() / 2,
                centerCanvasY = canvas.height() / 2;

            context.translate(centerCanvasX, centerCanvasY);
            context.rotate(radians);
            context.translate(-centerImageX, -centerImageY);

            context.drawImage(image[0], 0, 0, imageWidth, imageHeight);
        };

        var drawImage = function () {

            ctx.save();

            ctx.clearRect(0, 0, $canvas.width(), $canvas.height());
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, $canvas.width(), $canvas.height());

            ctx.shadowBlur = options.shadowBlur;
            ctx.shadowColor = "black";

            drawImageRotated(ctx, $canvas, $image, rotation);

            ctx.restore();
        };

        /*
         * Animation function to rotate the image
         */
        var animate = function (toDegrees, degreeIncrement) {

            window.requestAnimationFrame(function () {

                rotation += degreeIncrement;
                paint();

                if ((degreeIncrement < 0 && rotation > toDegrees) ||
                    (degreeIncrement > 0 && rotation < toDegrees)) {
                    isAnimating = true;
                    animate(toDegrees, degreeIncrement);
                } else {
                    isAnimating = false;
                    my.zoom(options.zoom);
                }
            });
        };

        /*
         * Rotates the image to the given angle
         */
        my.rotate = function (degrees) {

            // In case there is an animation going on, reset rotation to the target rotation before
            // applying the new angle
            rotation = targetRotation;
            targetRotation = degrees;

            animate(degrees, degrees < rotation ? -6 : 6);
        };

        my.zoom = function (factor) {

            options.zoom = factor;

            var deltaX  = ($canvas.width() / 2) - ($image[0].width / 2),
                deltaY  = ($canvas.height() / 2) - ($image[0].height / 2),
                centerX = ($image[0].width / 2),
                centerY = ($image[0].height / 2),
                ratio   = (1 / factor);

            if (rotation % 180 === 0) {
                tracker.viewPort.x = deltaX + (centerX - (centerX * ratio));
                tracker.viewPort.y = deltaY + (centerY - (centerY * ratio));
                tracker.viewPort.x2 = tracker.viewPort.x + ($image[0].width / factor);
                tracker.viewPort.y2 = tracker.viewPort.y + ($image[0].height / factor);
            } else {
                tracker.viewPort.x = deltaY + (centerY - (centerY * ratio));
                tracker.viewPort.y = deltaX + (centerX - (centerX * ratio));
                tracker.viewPort.x2 = tracker.viewPort.x + ($image[0].height / factor);
                tracker.viewPort.y2 = tracker.viewPort.y + ($image[0].width / factor);
            }

            paint();
        };

        my.getZoomFactor = function () {
            return options.zoom;
        };

        /*
         * Rotates the image clockwise by 90 degrees
         */
        my.clockwise = function () {
            my.rotate(rotation + 90);
        };

        /*
         * Rotates the image anti-clockwise by 90 degrees
         */
        my.anticlockwise = function () {
            my.rotate(rotation - 90);
        };

        /*
         * Returns the current rotation of the image in degrees).  Note
         * that this is the raw rotation value, so epect values outside
         * of the 0, 90, 180 and 270 range.
         */
        my.getRotation = function () {
            return targetRotation;
        };

        my.draggable = tracker.draggable;
        my.drawable  = tracker.drawable;
        my.resizable = tracker.resizable;

        my.setDraggable = tracker.setDraggable;
        my.setDrawable = tracker.setDrawable;
        my.setResizable = function (r) {
            tracker.setResizable(r);
            paint();
        };

        var drawPreview = function (outputCanvas, scale) {
            var $dest = $(outputCanvas),
                clip = my.getViewPort(),
                destCtx = outputCanvas.getContext("2d");

            var sourceImage = new Image();
            var isPortrait = rotation % 180 !== 0;

            $dest.attr("width", clip.width() * scale);
            $dest.attr("height", clip.height() * scale);

            sourceImage.onload = function () {
                destCtx.drawImage(sourceImage,
                    clip.left(),
                    clip.top(),
                    clip.width(),
                    clip.height(),
                    0,
                    0,
                    clip.width() * scale,
                    clip.height() * scale);
            };

            sourceImage.src = $image.attr("src");
        };

        my.paintPreview = function (outputCanvas, scale) {

            window.requestAnimationFrame(function () {
                drawPreview(outputCanvas, scale);
            });
        };

        /*
         * Returns the clip rectangle, translated based on the current rotation
         */
        my.getViewPort = function () {

            // Translate clip rect based on the offset of the image
            // in relation to the canvas (and the current rotation)
            var cloned = tracker.viewPort.clone(),
                deltaX = ($canvas.width() / 2) - ($image[0].width / 2),
                deltaY = ($canvas.height() / 2) - ($image[0].height / 2);

            if (rotation % 180 === 0) {
                cloned.move(-deltaX, -deltaY);
            } else {
                cloned.move(-deltaY, -deltaX);
            }

            return cloned;
        };

        adopt($image, $canvas);

        my.zoom(options.zoom);

        // If the image is not yet loaded, add a handler to paint when available
        $image.load(paint);

        // Force a paint in case the load event does not fire
        paint();

        return my;
    });

    global.PanAndZoomCanvas = PanAndZoomCanvas;

}(this));
