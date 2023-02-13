// Copyright (C) 2023 Andrea Ballestrazzi
import 'astali_app_home.dart';

import 'package:flutter/material.dart';

/// Represents the main widget app that is created at application initialization.
class AstaliApp extends StatelessWidget {
  const AstaliApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(title: 'Astali', home: AstaliAppHome());
  }
}
