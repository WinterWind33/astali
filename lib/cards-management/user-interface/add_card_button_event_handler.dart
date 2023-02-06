// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:flutter/material.dart';

/// Represents the callbacks that are triggered when the Add Card button is
/// tapped.
abstract class AddCardButtonEventHandler {
  /// Called when the Add Card buton is clicked by the user.
  void onAddCardClicked(BuildContext buildContext);
}
