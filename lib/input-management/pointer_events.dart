// Copyright (c) 2023 Andrea Ballestrazzi

// Core and engine
import 'dart:math';
import 'package:flutter/gestures.dart';

/// Sets of event for pointers.

typedef OnPointerHoverEvent = void Function(PointerHoverEvent);
typedef OnPointerUpEvent = void Function(PointerUpEvent);
typedef OnPointerDownEvent = void Function(PointerDownEvent);

typedef MouseButton = int;
typedef MousePoint = Point<double>;

/// Checks whether or not the given mouse button code corresponds to
/// the right mouse button.
bool isRightMouseButton(MouseButton mouseButton) {
  return mouseButton == kSecondaryMouseButton;
}
